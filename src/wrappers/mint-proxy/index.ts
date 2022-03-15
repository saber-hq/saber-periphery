import type { Address } from "@project-serum/anchor";
import { translateAddress, utils } from "@project-serum/anchor";
import type { TransactionEnvelope } from "@saberhq/solana-contrib";
import type { u64 } from "@saberhq/token-utils";
import {
  ChainId,
  createMintInstructions,
  Token,
  TOKEN_PROGRAM_ID,
  TokenAmount,
} from "@saberhq/token-utils";
import type { TransactionInstruction } from "@solana/web3.js";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";

import { SABER_ADDRESSES } from "../../constants";
import type { MinterInfo, MintProxyProgram } from "../../programs";
import type { Saber } from "../../sdk";
import type { PendingMintAndProxy, PendingMintProxy } from "./types";

async function associated(
  programId: Address,
  ...args: Array<Address | Buffer>
): Promise<PublicKey> {
  const seeds = [Buffer.from([97, 110, 99, 104, 111, 114])]; // b"anchor".
  args.forEach((arg) => {
    seeds.push(arg instanceof Buffer ? arg : translateAddress(arg).toBuffer());
  });
  const [assoc] = await PublicKey.findProgramAddress(
    seeds,
    translateAddress(programId)
  );
  return assoc;
}

/**
 * Finds the address of a minter.
 * @param minter
 * @returns
 */
export const findMinterInfoAddress = async (
  minter: PublicKey
): Promise<PublicKey> => {
  return await associated(SABER_ADDRESSES.MintProxy, minter);
};

export class MintProxyWrapper {
  readonly program: MintProxyProgram;

  constructor(readonly saber: Saber) {
    this.program = saber.programs.MintProxy;
  }

  async getProxyMintAuthority(): Promise<[PublicKey, number]> {
    const stateAccount = this.program.state.address();
    return await PublicKey.findProgramAddress(
      [utils.bytes.utf8.encode("SaberMintProxy"), stateAccount.toBuffer()],
      this.program.programId
    );
  }

  async new({
    hardcap,
    mintAuthority,
    tokenMint,
    tokenProgram = TOKEN_PROGRAM_ID,
    owner = this.program.provider.wallet.publicKey,
  }: {
    hardcap: u64;
    mintAuthority: PublicKey;
    owner?: PublicKey;
    tokenMint: PublicKey;
    tokenProgram?: PublicKey;
  }): Promise<PendingMintProxy> {
    const [proxyMintAuthority, nonce] = await this.getProxyMintAuthority();
    const instructions: TransactionInstruction[] = [];
    instructions.push(
      this.program.state.instruction.new(nonce, hardcap, {
        accounts: {
          mintAuthority,
          proxyMintAuthority,
          owner,
          tokenMint,
          tokenProgram,
        },
      })
    );

    return {
      proxyAuthority: proxyMintAuthority,
      tx: this.saber.newTx(instructions),
    };
  }

  async createMintWithProxy(
    hardcap: u64,
    mintKey: PublicKey = Keypair.generate().publicKey,
    decimals: number,
    owner: PublicKey | null = null
  ): Promise<PendingMintAndProxy> {
    const provider = this.saber.provider;
    owner = owner ?? provider.wallet.publicKey;
    const mintInstructions = await createMintInstructions(
      provider,
      owner,
      mintKey,
      decimals
    );

    const [proxyMintAuthority] = await this.getProxyMintAuthority();
    const tx = await this.initMintProxy({
      hardCap: new TokenAmount(
        new Token({
          address: mintKey.toString(),
          chainId: ChainId.MainnetBeta,
          decimals,
          name: "Saber Protocol Token",
          symbol: "SBR",
        }),
        hardcap
      ),
    });
    tx.instructions.unshift(...mintInstructions);
    return {
      mint: mintKey,
      proxyAuthority: proxyMintAuthority,
      tx,
    };
  }

  /**
   * Initializes the mint proxy with the given hardcap.
   *
   * The provider must be the mint authority and the owner of the mint.
   *
   * @returns
   */
  async initMintProxy({
    hardCap,
  }: {
    hardCap: TokenAmount;
  }): Promise<TransactionEnvelope> {
    const owner = this.program.provider.wallet.publicKey;
    const [proxyMintAuthority, nonce] = await this.getProxyMintAuthority();
    const instructions = [
      this.program.state.instruction.new(nonce, hardCap.toU64(), {
        accounts: {
          mintAuthority: owner,
          proxyMintAuthority,
          owner,
          tokenMint: hardCap.token.mintAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
      }),
    ];
    return this.saber.newTx(instructions);
  }

  async getMinterInfoAddress(minter: PublicKey): Promise<PublicKey> {
    return await this.program.account.minterInfo.associatedAddress(minter);
  }

  /**
   * Fetches info on a minter.
   * @param minter
   * @returns
   */
  async fetchMinterInfo(minter: PublicKey): Promise<MinterInfo | null> {
    const minterInfoAddress = await this.getMinterInfoAddress(minter);
    const accountInfo = await this.program.provider.connection.getAccountInfo(
      minterInfoAddress
    );
    if (!accountInfo) {
      return null;
    }
    return this.program.coder.accounts.decode<MinterInfo>(
      "MinterInfo",
      accountInfo.data
    );
  }

  async minterAdd(
    minter: PublicKey,
    allowance: u64,
    owner: PublicKey = this.program.provider.wallet.publicKey
  ): Promise<TransactionEnvelope> {
    const minterInfo = await this.program.account.minterInfo.associatedAddress(
      minter
    );
    const ix = this.program.state.instruction.minterAdd(allowance, {
      accounts: {
        auth: { owner },
        minter,
        minterInfo,
        payer: this.program.provider.wallet.publicKey,
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: SystemProgram.programId,
      },
    });
    return this.saber.newTx([ix]);
  }

  /**
   * Updates a minter's allowance.
   * @param minter
   * @param allowance
   * @returns
   */
  async minterUpdate(
    minter: PublicKey,
    allowance: u64
  ): Promise<TransactionEnvelope> {
    const minterInfo = await this.program.account.minterInfo.associatedAddress(
      minter
    );
    const ix = this.program.state.instruction.minterUpdate(allowance, {
      accounts: {
        auth: { owner: this.program.provider.wallet.publicKey },
        minterInfo,
      },
    });
    return this.saber.newTx([ix]);
  }

  async minterRemove(
    minter: PublicKey,
    owner: PublicKey = this.program.provider.wallet.publicKey
  ): Promise<TransactionEnvelope> {
    const minterInfo = await this.program.account.minterInfo.associatedAddress(
      minter
    );
    const ix = this.program.state.instruction.minterRemove({
      accounts: {
        auth: { owner },
        minter,
        minterInfo,
        payer: this.program.provider.wallet.publicKey,
      },
    });
    return this.saber.newTx([ix]);
  }

  transferOwnership(nextOwner: PublicKey): TransactionEnvelope {
    return this.saber.newTx([
      this.program.state.instruction.transferOwnership(nextOwner, {
        accounts: { owner: this.program.provider.wallet.publicKey },
      }),
    ]);
  }

  acceptOwnership(): TransactionEnvelope {
    return this.saber.newTx([
      this.program.state.instruction.acceptOwnership({
        accounts: { owner: this.program.provider.wallet.publicKey },
      }),
    ]);
  }

  async mintProxyExists(): Promise<boolean> {
    try {
      await this.program.state.fetch();
    } catch (e) {
      return false;
    }
    return true;
  }
}
