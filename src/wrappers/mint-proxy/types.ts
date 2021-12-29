import type { TransactionEnvelope } from "@saberhq/solana-contrib";
import type { PublicKey } from "@solana/web3.js";

export interface PendingMintProxy {
  proxyAuthority: PublicKey;
  tx: TransactionEnvelope;
}

export interface PendingMintAndProxy {
  mint: PublicKey;
  proxyAuthority: PublicKey;
  tx: TransactionEnvelope;
}
