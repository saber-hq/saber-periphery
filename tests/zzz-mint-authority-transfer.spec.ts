import { getMintInfo, TOKEN_PROGRAM_ID } from "@saberhq/token-utils";
import * as assert from "assert";

import { getRewardsMint } from "./_beforeAll.spec";
import { makeSDK } from "./workspace";

// This test must run LAST
// TODO: migrate off of the old mint wrapper to Quarry Mint Wrapper,
// via the below function
describe("Mint authority transfer", () => {
  const sdk = makeSDK();
  const { mintProxy, provider } = sdk;
  const { MintProxy } = sdk.programs;

  it("Set new mint authority", async () => {
    const [proxyAuthority] = await mintProxy.getProxyMintAuthority();
    const mint = getRewardsMint();
    await assert.doesNotReject(async () => {
      await MintProxy.state.rpc.setMintAuthority(provider.wallet.publicKey, {
        accounts: {
          auth: { owner: provider.wallet.publicKey },
          proxyMintAuthority: proxyAuthority,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
      });
    });

    const mintInfo = await getMintInfo(provider, mint);
    assert.ok(mintInfo.mintAuthority?.equals(provider.wallet.publicKey));
  });
});
