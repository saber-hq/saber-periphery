/// <reference types="mocha" />

import { expectTX } from "@saberhq/chai-solana";
import {
  createMint,
  createMintToInstruction,
  getATAAddress,
  getOrCreateATAs,
  getTokenAccount,
  u64,
  ZERO,
} from "@saberhq/token-utils";
import type { PublicKey } from "@solana/web3.js";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import invariant from "tiny-invariant";

import { getRewardsMint } from "./_beforeAll.spec";
import { DEFAULT_DECIMALS, makeSDK } from "./workspace";

describe("Redeemer", () => {
  const sdk = makeSDK();
  const { provider } = sdk;

  let redeemerBump: number;

  let userAuthority: Keypair;

  let iouMint: PublicKey;
  let iouMintAuthority: Keypair;
  let iouSource: PublicKey;

  let redemptionMint: PublicKey;
  let redemptionDestination: PublicKey;

  before(() => {
    redemptionMint = getRewardsMint();
  });

  beforeEach(async () => {
    iouMintAuthority = Keypair.generate();
    iouMint = await createMint(
      provider,
      iouMintAuthority.publicKey,
      DEFAULT_DECIMALS
    );

    userAuthority = Keypair.generate();
    // Airdrop to user
    await provider.connection.requestAirdrop(
      userAuthority.publicKey,
      10 * LAMPORTS_PER_SOL
    );

    const { bump, tx } = await sdk.createRedeemer({
      iouMint,
      redemptionMint,
    });
    const { accounts, createAccountInstructions } = await getOrCreateATAs({
      provider,
      mints: {
        iouMint,
        redemptionMint,
      },
      owner: userAuthority.publicKey,
    });

    invariant(
      createAccountInstructions.iouMint,
      "create user ATA account for iouMint"
    );
    invariant(
      createAccountInstructions.redemptionMint,
      "create user ATA account for redemptionMint"
    );
    tx.instructions.push(
      createAccountInstructions.iouMint,
      createAccountInstructions.redemptionMint
    );
    tx.instructions.push(
      ...createMintToInstruction({
        provider,
        mint: iouMint,
        mintAuthorityKP: iouMintAuthority,
        to: accounts.iouMint,
        amount: new u64(1_000 * DEFAULT_DECIMALS),
      }).instructions
    );
    tx.addSigners(iouMintAuthority);
    await expectTX(tx, "create redeemer").to.be.fulfilled;

    iouSource = accounts.iouMint;

    redeemerBump = bump;
    redemptionDestination = accounts.redemptionMint;
  });

  it("Redeemer was initialized", async () => {
    const { key, data } = await sdk.loadRedeemer({
      iouMint,
      redemptionMint,
    });

    expect(data.bump).to.equal(redeemerBump);
    expect(data.iouMint).to.eqAddress(iouMint);
    expect(data.redemptionMint).to.eqAddress(redemptionMint);
    expect(data.redemptionVault).to.eqAddress(
      await getATAAddress({
        mint: redemptionMint,
        owner: key,
      })
    );
  });

  it("Redeem tokens from mint proxy", async () => {
    const redeemerWrapper = await sdk.loadRedeemer({
      iouMint,
      redemptionMint,
    });

    let iouSourceAccout = await getTokenAccount(provider, iouSource);
    const expectedAmount = iouSourceAccout.amount;

    const mintProxy = redeemerWrapper.sdk.mintProxy;
    const tx = await mintProxy.minterAdd(redeemerWrapper.key, expectedAmount);
    tx.instructions.push(
      await redeemerWrapper.redeemTokensFromMintProxyIx({
        tokenAmount: expectedAmount,
        sourceAuthority: userAuthority.publicKey,
        iouSource,
        redemptionDestination,
      })
    );
    tx.addSigners(userAuthority);
    await expectTX(tx, "redeeming tokens from mint proxy").to.be.fulfilled;

    iouSourceAccout = await getTokenAccount(provider, iouSource);
    expect(iouSourceAccout.amount.toString()).to.equal(ZERO.toString());
    const redemptionDestinationAccount = await getTokenAccount(
      provider,
      redemptionDestination
    );
    expect(redemptionDestinationAccount.amount.toString()).to.equal(
      expectedAmount.toString()
    );
  });
});
