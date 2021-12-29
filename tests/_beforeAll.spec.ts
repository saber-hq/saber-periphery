/// <reference types="mocha" />

import { expectTX } from "@saberhq/chai-solana";
import { PendingTransaction } from "@saberhq/solana-contrib";
import { createMint } from "@saberhq/token-utils";
import type { PublicKey } from "@solana/web3.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import invariant from "tiny-invariant";

import { DEFAULT_DECIMALS, DEFAULT_HARD_CAP, makeSDK } from "./workspace";

let rewardsMint: PublicKey | null = null;

export const getRewardsMint = (): PublicKey => {
  invariant(rewardsMint, "not initialized");
  return rewardsMint;
};

if (!rewardsMint) {
  before("Initialize mint", async () => {
    const saber = makeSDK();
    const { provider, mintProxy } = saber;

    await new PendingTransaction(
      provider.connection,
      await provider.connection.requestAirdrop(
        provider.wallet.publicKey,
        LAMPORTS_PER_SOL * 10
      )
    ).wait();

    rewardsMint = await createMint(
      provider,
      provider.wallet.publicKey,
      DEFAULT_DECIMALS
    );

    const { tx } = await mintProxy.new({
      hardcap: DEFAULT_HARD_CAP,
      mintAuthority: provider.wallet.publicKey,
      tokenMint: rewardsMint,
    });

    await expectTX(tx, "Initialize MintProxy").to.be.fulfilled;
  });
}
