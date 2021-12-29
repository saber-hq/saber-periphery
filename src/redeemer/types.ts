import type { TransactionEnvelope } from "@saberhq/solana-contrib";
import type { u64 } from "@saberhq/token-utils";
import type { PublicKey } from "@solana/web3.js";

import type { Saber } from "../sdk";

export type RedeemerWrapperCtorArgs = {
  sdk: Saber;
  iouMint: PublicKey;
  redemptionMint: PublicKey;
};

export type PendingRedeemer = {
  bump: number;
  ctorArgs: RedeemerWrapperCtorArgs;
  tx: TransactionEnvelope;
};

export type RedeemTokenArgs = {
  tokenAmount: u64;
  sourceAuthority: PublicKey;
  iouSource: PublicKey;
  redemptionDestination: PublicKey;
};
