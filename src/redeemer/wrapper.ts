import { TransactionEnvelope } from "@saberhq/solana-contrib";
import type { u64 } from "@saberhq/token-utils";
import {
  getOrCreateATA,
  getOrCreateATAs,
  TOKEN_PROGRAM_ID,
} from "@saberhq/token-utils";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";

import { SABER_ADDRESSES } from "../constants";
import type { RedeemerData, RedeemerProgram } from "../programs/redeemer";
import type { Saber } from "../sdk";
import { findRedeemerKey } from "./pda";
import type {
  PendingRedeemer,
  RedeemerWrapperCtorArgs,
  RedeemTokenArgs,
} from "./types";

export class RedeemerWrapper {
  constructor(
    readonly sdk: Saber,
    readonly key: PublicKey,
    readonly iouMintKey: PublicKey,
    readonly redemptionMintKey: PublicKey,
    readonly data: RedeemerData
  ) {}

  get program(): RedeemerProgram {
    return this.sdk.programs.Redeemer;
  }

  static async load(args: RedeemerWrapperCtorArgs): Promise<RedeemerWrapper> {
    const { iouMint, redemptionMint, sdk } = args;
    const [redeemer] = await findRedeemerKey({ iouMint, redemptionMint });
    const program = sdk.programs.Redeemer;
    const data = await program.account.redeemer.fetch(redeemer);

    return new RedeemerWrapper(sdk, redeemer, iouMint, redemptionMint, data);
  }

  static async createRedeemer(
    ctorArgs: RedeemerWrapperCtorArgs
  ): Promise<PendingRedeemer> {
    const { iouMint, redemptionMint, sdk } = ctorArgs;
    const { provider } = sdk;
    const [redeemer, bump] = await findRedeemerKey({ iouMint, redemptionMint });

    const instructions: TransactionInstruction[] = [];
    const { address, instruction } = await getOrCreateATA({
      provider,
      mint: redemptionMint,
      owner: redeemer,
    });
    if (instruction) {
      instructions.push(instruction);
    }

    instructions.push(
      sdk.programs.Redeemer.instruction.createRedeemer(bump, {
        accounts: {
          redeemer,
          tokens: {
            iouMint,
            redemptionMint,
            redemptionVault: address,
          },
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        },
      })
    );

    return {
      bump,
      ctorArgs,
      tx: new TransactionEnvelope(sdk.provider, instructions),
    };
  }

  /**
   * redeemTokensIx
   */
  redeemTokensIx(args: RedeemTokenArgs): TransactionInstruction {
    return this.program.instruction.redeemTokens(args.tokenAmount, {
      accounts: this.getRedeemTokenAccounts(args),
    });
  }

  /**
   * redeemTokensFromMintProxyIx
   */
  async redeemTokensFromMintProxyIx(
    args: RedeemTokenArgs
  ): Promise<TransactionInstruction> {
    const { account, state } = this.sdk.programs.MintProxy;
    const mintProxyData = await state.fetch();

    return this.program.instruction.redeemTokensFromMintProxy(
      args.tokenAmount,
      {
        accounts: {
          redeemCtx: this.getRedeemTokenAccounts(args),
          proxyMintAuthority: mintProxyData.proxyMintAuthority,
          minterInfo: await account.minterInfo.associatedAddress(this.key),
          mintProxyState: state.address(),
          mintProxyProgram: SABER_ADDRESSES.MintProxy,
        },
      }
    );
  }

  /**
   * redeemAllTokensFromMintProxyIx
   */
  async redeemAllTokensFromMintProxyIx(
    args: Omit<RedeemTokenArgs, "tokenAmount">
  ): Promise<TransactionInstruction> {
    const { account, state } = this.sdk.programs.MintProxy;
    const mintProxyData = await state.fetch();

    return this.program.instruction.redeemAllTokensFromMintProxy({
      accounts: {
        redeemCtx: this.getRedeemTokenAccounts(args),
        proxyMintAuthority: mintProxyData.proxyMintAuthority,
        minterInfo: await account.minterInfo.associatedAddress(this.key),
        mintProxyState: state.address(),
        mintProxyProgram: SABER_ADDRESSES.MintProxy,
      },
    });
  }

  /**
   * redeemTokensFromMintProxy
   */
  async redeemTokensFromMintProxy(
    {
      amount,
      sourceAuthority = this.sdk.provider.wallet.publicKey,
    }: {
      /**
       * Amount of tokens to redeem. If unspecified, defaults to redeeming all tokens.
       */
      amount?: u64;
      sourceAuthority: PublicKey;
    } = {
      sourceAuthority: this.sdk.provider.wallet.publicKey,
    }
  ): Promise<TransactionEnvelope> {
    const atas = await getOrCreateATAs({
      provider: this.sdk.provider,
      mints: {
        iou: this.data.iouMint,
        redemption: this.data.redemptionMint,
      },
      owner: sourceAuthority,
    });

    const commonArgs = {
      sourceAuthority,
      iouSource: atas.accounts.iou,
      redemptionDestination: atas.accounts.redemption,
    };
    const redeemIX = amount
      ? await this.redeemTokensFromMintProxyIx({
          ...commonArgs,
          tokenAmount: amount,
        })
      : await this.redeemAllTokensFromMintProxyIx(commonArgs);

    return new TransactionEnvelope(this.sdk.provider, [
      ...atas.instructions,
      redeemIX,
    ]);
  }

  getRedeemTokenAccounts(args: Omit<RedeemTokenArgs, "tokenAmount">): {
    redeemer: PublicKey;
    tokens: {
      iouMint: PublicKey;
      redemptionMint: PublicKey;
      redemptionVault: PublicKey;
      tokenProgram: PublicKey;
    };
    sourceAuthority: PublicKey;
    iouSource: PublicKey;
    redemptionDestination: PublicKey;
  } {
    const { iouSource, redemptionDestination, sourceAuthority } = args;
    return {
      redeemer: this.key,
      tokens: {
        iouMint: this.data.iouMint,
        redemptionMint: this.data.redemptionMint,
        redemptionVault: this.data.redemptionVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
      sourceAuthority,
      iouSource,
      redemptionDestination,
    };
  }
}
