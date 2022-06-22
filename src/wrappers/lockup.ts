import type { TransactionEnvelope } from "@saberhq/solana-contrib";
import type { u64 } from "@saberhq/token-utils";
import { getOrCreateATA, TOKEN_PROGRAM_ID } from "@saberhq/token-utils";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import BN from "bn.js";

import type { LockupProgram, ReleaseData } from "../programs/lockup";
import type { Saber } from "../sdk";

const ZERO = new BN(0);

export interface PendingRelease {
  release: PublicKey;
  tx: TransactionEnvelope;
}

export class LockupWrapper {
  readonly program: LockupProgram;
  constructor(readonly saber: Saber) {
    this.program = saber.programs.Lockup;
  }

  get provider() {
    return this.saber.provider;
  }

  async releaseAddress(beneficiary: PublicKey): Promise<PublicKey> {
    return await this.program.account.release.associatedAddress(beneficiary);
  }

  async fetchRelease(beneficiary: PublicKey): Promise<ReleaseData | null> {
    const key = await this.releaseAddress(beneficiary);
    const data = await this.provider.connection.getAccountInfo(key);
    if (!data) {
      return null;
    }
    return this.program.coder.accounts.decode<ReleaseData>(
      "Release",
      data.data
    );
  }

  createRelease({
    amount,
    startTs,
    endTs,
    beneficiary,
    release,
    minterInfo,
    mint,
  }: {
    amount: BN;
    startTs: BN;
    endTs: BN;
    beneficiary: PublicKey;
    release: PublicKey;
    minterInfo: PublicKey;
    mint: PublicKey;
  }): PendingRelease {
    const minterAddIx =
      this.saber.programs.MintProxy.state.instruction.minterAdd(amount, {
        accounts: {
          auth: { owner: this.provider.wallet.publicKey },
          minter: release,
          minterInfo,
          payer: this.provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        },
      });
    const createReleaseIx = this.program.state.instruction.createRelease(
      amount,
      startTs,
      endTs,
      {
        accounts: {
          minterInfo,
          mint,
          auth: { owner: this.provider.wallet.publicKey },
          beneficiary,
          release,
          payer: this.provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
          mintProxyProgram: this.saber.programs.MintProxy.programId,
        },
      }
    );
    return {
      release,
      tx: this.saber.newTx([minterAddIx, createReleaseIx]),
    };
  }

  /**
   * Creates a release for a beneficiary.
   */
  async createReleaseForBeneficiary({
    amount,
    startTs,
    endTs,
    beneficiary,
  }: {
    amount: BN;
    startTs: BN;
    endTs: BN;
    beneficiary: PublicKey;
  }): Promise<PendingRelease> {
    const release = await this.releaseAddress(beneficiary);
    const minterInfo = await this.saber.mintProxy.getMinterInfoAddress(release);
    const mintProxyStateData =
      await this.saber.programs.MintProxy.state.fetch();
    return this.createRelease({
      amount,
      startTs,
      endTs,
      release,
      beneficiary,
      minterInfo,
      mint: mintProxyStateData.tokenMint,
    });
  }

  /**
   * Withdraws tokens.
   * @param beneficiary
   * @returns
   */
  async withdraw(
    beneficiary: PublicKey = this.saber.provider.wallet.publicKey,
    amount: u64 = ZERO
  ): Promise<TransactionEnvelope> {
    const mintProxyStateAddress = this.saber.mintProxy.program.state.address();
    const mintProxyState = await this.saber.mintProxy.program.state.fetch();

    const instructions: TransactionInstruction[] = [];
    const { address, instruction } = await getOrCreateATA({
      provider: this.saber.provider,
      mint: mintProxyState.tokenMint,
      owner: beneficiary,
    });
    if (instruction) {
      instructions.push(instruction);
    }

    const release = await this.releaseAddress(beneficiary);
    const accounts = {
      proxyMintAuthority: mintProxyState.proxyMintAuthority,
      tokenMint: mintProxyState.tokenMint,
      beneficiary,
      release,
      tokenAccount: address,
      tokenProgram: TOKEN_PROGRAM_ID,
      unusedClock: SYSVAR_CLOCK_PUBKEY,
      minterInfo: await this.saber.mintProxy.getMinterInfoAddress(release),
      mintProxyState: mintProxyStateAddress,
      mintProxyProgram: this.saber.programs.MintProxy.programId,
    };

    if (amount.isZero()) {
      instructions.push(
        this.program.state.instruction.withdraw({
          accounts,
        })
      );
    } else {
      instructions.push(
        this.program.state.instruction.withdrawWithAmount(amount, { accounts })
      );
    }

    return this.saber.newTx(instructions);
  }

  /**
   * Creates a release for a beneficiary.
   */
  async revokeReleaseForBeneficiary({
    beneficiary,
  }: {
    beneficiary: PublicKey;
  }): Promise<PendingRelease> {
    const release = await this.releaseAddress(beneficiary);
    const minterInfo = await this.saber.mintProxy.getMinterInfoAddress(release);
    const minterRemoveIx =
      this.saber.programs.MintProxy.state.instruction.minterRemove({
        accounts: {
          auth: { owner: this.provider.wallet.publicKey },
          minter: release,
          minterInfo,
          payer: this.provider.wallet.publicKey,
        },
      });
    const revokeReleaseIx = this.program.state.instruction.revokeRelease({
      accounts: {
        auth: { owner: this.provider.wallet.publicKey },
        release,
        payer: this.provider.wallet.publicKey,
      },
    });
    return {
      release,
      tx: this.saber.newTx([minterRemoveIx, revokeReleaseIx]),
    };
  }
}
