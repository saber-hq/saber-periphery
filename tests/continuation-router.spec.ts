/// <reference types="mocha" />

import * as anchor from "@project-serum/anchor";
import { expectTX } from "@saberhq/chai-solana";
import { SignerWallet } from "@saberhq/solana-contrib";
import type { StableSwap } from "@saberhq/stableswap-sdk";
import { deployNewSwap, SWAP_PROGRAM_ID } from "@saberhq/stableswap-sdk";
import * as serumCmn from "@saberhq/token-utils";
import {
  getATAAddress,
  getOrCreateATAs,
  getTokenAccount,
  SPLToken,
  Token,
  TOKEN_PROGRAM_ID,
  TokenAmount,
  u64,
} from "@saberhq/token-utils";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import invariant from "tiny-invariant";

import type { SwapCompleteEvent } from "../src";
import { SABER_CODERS, WrappedToken } from "../src";
import { WrappedTokenActions } from "../src/router/wrappers/wrappedTokenActions";
import { initATA } from "./utils";
import {
  balanceOf,
  createTestToken,
  DEFAULT_DECIMALS,
  LOCAL_CHAIN_ID,
  makeSDK,
} from "./workspace";

describe("Router", () => {
  // Read the provider from the configured environment.
  const sdk = makeSDK();
  const { provider } = sdk;

  const { BN, web3 } = anchor;

  let mintA: anchor.web3.PublicKey;
  let mintB: anchor.web3.PublicKey;
  let mintC: anchor.web3.PublicKey;
  let tokenA: Token;
  let tokenB: Token;
  let tokenC: Token;

  let minter: anchor.web3.Keypair;
  let admin: anchor.web3.Keypair;

  // AB swap
  let abSwap: StableSwap;
  // BC swap
  let bcSwap: StableSwap;

  before("Set up the pools", async () => {
    minter = web3.Keypair.generate();
    admin = web3.Keypair.generate();

    await provider.connection.requestAirdrop(
      provider.wallet.publicKey,
      100 * 1_000_000_000
    );
    await provider.connection.requestAirdrop(
      minter.publicKey,
      100 * 1_000_000_000
    );
    await provider.connection.requestAirdrop(
      admin.publicKey,
      100 * 1_000_000_000
    );

    mintA = await serumCmn.createMint(
      provider,
      minter.publicKey,
      DEFAULT_DECIMALS
    );
    mintB = await serumCmn.createMint(
      provider,
      minter.publicKey,
      DEFAULT_DECIMALS
    );
    mintC = await serumCmn.createMint(
      provider,
      minter.publicKey,
      DEFAULT_DECIMALS
    );

    tokenA = new Token({
      name: "token a",
      decimals: DEFAULT_DECIMALS,
      address: mintA.toString(),
      chainId: LOCAL_CHAIN_ID,
      symbol: "TOKA",
    });
    tokenB = new Token({
      name: "token b",
      decimals: DEFAULT_DECIMALS,
      address: mintB.toString(),
      chainId: LOCAL_CHAIN_ID,
      symbol: "TOKB",
    });
    tokenC = new Token({
      name: "token c",
      decimals: DEFAULT_DECIMALS,
      address: mintC.toString(),
      chainId: LOCAL_CHAIN_ID,
      symbol: "TOKC",
    });

    console.log("Deploying pool A<->B");
    const adminProvider = new SignerWallet(admin).createProvider(
      provider.connection
    );
    const swapAB = await deployNewSwap({
      provider: adminProvider,
      swapProgramID: SWAP_PROGRAM_ID,

      tokenAMint: mintA,
      tokenBMint: mintB,
      adminAccount: admin.publicKey,
      ampFactor: new u64(1_000),

      seedPoolAccounts: ({ tokenAAccount, tokenBAccount }) => ({
        instructions: [
          SPLToken.createMintToInstruction(
            TOKEN_PROGRAM_ID,
            mintA,
            tokenAAccount,
            minter.publicKey,
            [],
            1_000_000
          ),
          SPLToken.createMintToInstruction(
            TOKEN_PROGRAM_ID,
            mintB,
            tokenBAccount,
            minter.publicKey,
            [],
            1_000_000
          ),
        ],
        signers: [minter],
      }),
    });
    abSwap = swapAB.swap;

    console.log("Deploying pool ABLP<->C");
    await deployNewSwap({
      provider: adminProvider,
      swapProgramID: SWAP_PROGRAM_ID,

      tokenAMint: abSwap.state.poolTokenMint,
      tokenBMint: mintC,
      adminAccount: admin.publicKey,
      ampFactor: new u64(1_000),

      seedPoolAccounts: ({ tokenAAccount, tokenBAccount }) => ({
        instructions: [
          SPLToken.createTransferInstruction(
            TOKEN_PROGRAM_ID,
            swapAB.initializeArgs.destinationPoolTokenAccount,
            tokenAAccount,
            admin.publicKey,
            [],
            1_000_000
          ),
          SPLToken.createMintToInstruction(
            TOKEN_PROGRAM_ID,
            mintC,
            tokenBAccount,
            minter.publicKey,
            [],
            1_000_000
          ),
        ],
        signers: [minter, admin],
      }),
    });

    console.log("Deploying pool BCLP");
    const { swap: bcLPSwap } = await deployNewSwap({
      provider: adminProvider,
      swapProgramID: SWAP_PROGRAM_ID,

      tokenAMint: mintB,
      tokenBMint: mintC,
      adminAccount: admin.publicKey,
      ampFactor: new u64(1_000),

      seedPoolAccounts: ({ tokenAAccount, tokenBAccount }) => ({
        instructions: [
          SPLToken.createMintToInstruction(
            TOKEN_PROGRAM_ID,
            mintB,
            tokenAAccount,
            minter.publicKey,
            [],
            1_000_000
          ),
          SPLToken.createMintToInstruction(
            TOKEN_PROGRAM_ID,
            mintC,
            tokenBAccount,
            minter.publicKey,
            [],
            1_000_000
          ),
        ],
        signers: [minter, admin],
      }),
    });
    bcSwap = bcLPSwap;
  });

  let user: anchor.web3.Keypair;
  let userAccountA: anchor.web3.PublicKey;
  let userAccountC: anchor.web3.PublicKey;

  beforeEach("set up user accounts", async () => {
    user = web3.Keypair.generate();
    const tx = await provider.connection.requestAirdrop(
      user.publicKey,
      100 * 1_000_000_000
    );
    await provider.connection.confirmTransaction(tx, "confirmed");
    // get and set up the accounts
    userAccountA = await getATAAddress({
      mint: mintA,
      owner: user.publicKey,
    });
    userAccountC = await getATAAddress({
      mint: mintC,
      owner: user.publicKey,
    });
  });

  const mintTokensAndCreateAccount = async (
    mint: PublicKey,
    account: PublicKey,
    amount: number,
    owner: PublicKey = user.publicKey
  ): Promise<void> => {
    // mint tokens
    await provider.send(
      new web3.Transaction().add(
        SPLToken.createAssociatedTokenAccountInstruction(
          serumCmn.ASSOCIATED_TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          mint,
          account,
          owner,
          minter.publicKey
        ),
        SPLToken.createMintToInstruction(
          TOKEN_PROGRAM_ID,
          mint,
          account,
          minter.publicKey,
          [],
          amount
        )
      ),
      [minter],
      {
        commitment: "confirmed",
      }
    );
  };

  describe("swap -> swap", () => {
    it("swaps transitively", async () => {
      // mint tokens
      await mintTokensAndCreateAccount(mintA, userAccountA, 1_000_000);

      // do the swap
      const userSDK = sdk.withSigner(user);
      const plan = userSDK.router.createPlan(
        new TokenAmount(tokenA, 999_000),
        new TokenAmount(tokenC, 1_000),
        [
          {
            swap: abSwap,
            action: "ssSwap",
            outputToken: tokenB,
          },
          {
            swap: bcSwap,
            action: "ssSwap",
            outputToken: tokenC,
          },
        ]
      );
      const tx = await plan.buildTX();

      const receipt = await tx.confirm();
      console.log(`Used ${receipt.computeUnits} units`);

      const allEvents =
        SABER_CODERS.ContinuationRouter.parseProgramLogEvents<SwapCompleteEvent>(
          receipt.response.meta?.logMessages?.filter((s): s is string => !!s)
        );
      const event = allEvents[allEvents.length - 1] as SwapCompleteEvent;

      expect(event.name).to.eq("SwapCompleteEvent");
      expect(event.data.amountIn.mint).to.eqAddress(tokenA.mintAccount);
      expect(event.data.amountIn.amount).bignumber.to.eq(new BN(999_000));
      expect(event.data.amountOut.mint).to.eqAddress(tokenC.mintAccount);
      expect(event.data.amountOut.amount).to.be.a.bignumber.lessThan(
        new BN(999_999)
      );
      expect(event.data.amountOut.amount).to.be.a.bignumber.greaterThan(
        new BN(1_000)
      );

      expect(
        (await getTokenAccount(provider, userAccountA)).amount,
        "Trade performed in"
      ).bignumber.to.eq(new BN(1_000));
      expect(
        (await getTokenAccount(provider, userAccountC)).amount,
        "Trade performed out"
      ).bignumber.to.eq(event.data.amountOut.amount);
    });

    it("zero swap is zero", async () => {
      // mint tokens
      await mintTokensAndCreateAccount(mintA, userAccountA, 1_000_000);

      // do the swap
      const userSDK = sdk.withSigner(user);
      const plan = userSDK.router.createPlan(
        new TokenAmount(tokenA, 0),
        new TokenAmount(tokenC, 0),
        [
          {
            swap: abSwap,
            action: "ssSwap",
            outputToken: tokenB,
          },
          {
            swap: bcSwap,
            action: "ssSwap",
            outputToken: tokenC,
          },
        ]
      );

      const tx = await plan.buildTX();
      try {
        await tx.confirm();
      } catch (e) {
        // TODO(igm): error should be parsed for the IDL errors
        expect(e).to.not.be.null;
      }

      expect(
        (await getTokenAccount(provider, userAccountA)).amount,
        "No money was swapped"
      ).bignumber.eq(new BN(1_000_000));
      await expect(
        getTokenAccount(provider, userAccountC),
        "No money was swapped"
      ).to.be.rejectedWith("Failed to find token account");
    });
  });

  describe("decimals wrapper", () => {
    let renBTC: Token;
    let wbtc: Token;
    let wbtc8: Token;
    let btcSwap: StableSwap;

    beforeEach(async () => {
      renBTC = await createTestToken(provider, "RenBTC", "rBTC", 8, minter);
      wbtc = await createTestToken(
        provider,
        "Wrapped Bitcoin",
        "WBTC",
        6,
        minter
      );

      // create 1_000 wbtc8 for the admin as initial liquidity
      await initATA(wbtc, admin, {
        minter,
        mintAmount: 1_000_000000,
      });

      const adminWBTC8 = await WrappedTokenActions.loadWithActions(
        sdk.withSigner(admin).provider,
        sdk.withSigner(admin).programs.AddDecimals,
        wbtc,
        8
      );
      await expectTX(adminWBTC8.createIfNotExists(), "create wbtc8").to.be
        .fulfilled;
      const newW = await adminWBTC8.reload();
      invariant(newW.token, "token not initialized");
      wbtc8 = newW.token;
      await expectTX(
        adminWBTC8.wrap(new TokenAmount(wbtc, 1_000_000000)),
        "wrap wbtc"
      ).to.be.fulfilled;
      const adminWBTC8Account = await adminWBTC8.getAssociatedTokenAddress();
      expect(
        await balanceOf(provider, wbtc8, admin),
        "wrap success"
      ).to.be.a.tokenAmount.equal(new BN(1_000_00000000));

      // deploy pool RenBTC<->sWBTC8
      const adminProvider = new SignerWallet(admin).createProvider(
        provider.connection
      );
      const { swap } = await deployNewSwap({
        provider: adminProvider,
        swapProgramID: SWAP_PROGRAM_ID,

        tokenAMint: renBTC.mintAccount,
        tokenBMint: wbtc8.mintAccount,
        adminAccount: admin.publicKey,
        ampFactor: new u64(1_000),

        seedPoolAccounts: ({ tokenAAccount, tokenBAccount }) => ({
          instructions: [
            SPLToken.createMintToInstruction(
              TOKEN_PROGRAM_ID,
              renBTC.mintAccount,
              tokenAAccount,
              minter.publicKey,
              [],
              1_000_00000000
            ),
            SPLToken.createTransferInstruction(
              TOKEN_PROGRAM_ID,
              adminWBTC8Account,
              tokenBAccount,
              admin.publicKey,
              [],
              1_000_00000000
            ),
          ],
          signers: [minter, admin],
        }),
      });

      expect(
        await balanceOf(provider, wbtc8, admin),
        "admin now has 0 wbtc8"
      ).to.be.tokenAmount.equal(new BN(0));

      btcSwap = swap;
    });

    it("wrapped token was initialized properly", async () => {
      const adminWBTC8 = await WrappedTokenActions.loadWithActions(
        sdk.withSigner(admin).provider,
        sdk.withSigner(admin).programs.AddDecimals,
        wbtc,
        8
      );

      const expectedDecimals = 8;
      const expectedMultiplier = new u64(
        Math.pow(10, expectedDecimals - wbtc.decimals)
      );
      const [expectedWrapperKey, expectedNonce] =
        await WrappedToken.getAddressAndNonce(
          adminWBTC8.program.programId,
          wbtc.mintAccount,
          expectedDecimals
        );

      const wrappedData = await adminWBTC8.loadData();
      expect(wrappedData.nonce).to.equal(expectedNonce);
      expect(wrappedData.decimals).to.equal(expectedDecimals);
      expect(wrappedData.multiplier).to.bignumber.equal(expectedMultiplier);
      expect(wrappedData.wrapperUnderlyingMint).to.eqAddress(wbtc.mintAccount);
      expect(adminWBTC8.wrapped.wrapper).to.eqAddress(expectedWrapperKey);
    });

    describe("wrap -> swap", () => {
      it("works", async () => {
        // mint tokens
        // get and set up the accounts
        // create 100 wbtc for the user
        await initATA(wbtc, user, {
          minter,
          mintAmount: 100_000000,
        });

        // do the swap
        const userSDK = sdk.withSigner(user);
        const plan = userSDK.router.createPlan(
          new TokenAmount(wbtc, 10_000000),
          new TokenAmount(renBTC, 9_90000000),
          [
            {
              action: "adDeposit",
              underlying: wbtc,
              decimals: 8,
              outputToken: wbtc8,
            },
            {
              action: "ssSwap",
              swap: btcSwap,
              outputToken: renBTC,
            },
          ]
        );
        const tx = await plan.buildTX();

        const receipt = await tx.confirm();
        receipt.printLogs();

        expect(await balanceOf(provider, wbtc, user)).to.tokenAmount.equal(
          new TokenAmount(wbtc, 90_000000)
        );
        expect(await balanceOf(provider, renBTC, user)).to.tokenAmount.equal(
          new TokenAmount(renBTC, 9_99990010)
        );
      });
    });

    describe("swap -> unwrap", () => {
      it("works", async () => {
        // mint tokens
        // get and set up the accounts
        // create 100 renbtc for the user
        await initATA(renBTC, user, {
          minter,
          mintAmount: 100_00000000,
        });

        // do the swap
        const userSDK = sdk.withSigner(user);
        const plan = userSDK.router.createPlan(
          new TokenAmount(renBTC, 10_00000000),
          new TokenAmount(wbtc, 9_900000),
          [
            {
              action: "ssSwap",
              swap: btcSwap,
              outputToken: wbtc8,
            },
            {
              action: "adWithdraw",
              underlying: wbtc,
              decimals: 8,
              outputToken: wbtc,
            },
          ]
        );
        const tx = await plan.buildTX();

        const receipt = await tx.confirm();
        receipt.printLogs();

        expect(await balanceOf(provider, renBTC, user)).to.tokenAmount.equal(
          new TokenAmount(renBTC, 90_00000000)
        );
        expect(await balanceOf(provider, wbtc8, user)).to.tokenAmount.equal(
          // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
          new TokenAmount(wbtc8, 0_00000010)
        );
        expect(await balanceOf(provider, wbtc, user)).to.tokenAmount.equal(
          new TokenAmount(wbtc, 9_999900)
        );
      });
    });

    describe("wrap/unwrap", () => {
      it("works", async () => {
        // mint tokens
        // get and set up the accounts
        // create 100 wbtc for the user
        await initATA(wbtc, user, {
          minter,
          mintAmount: 10_000000,
        });

        const codon = [
          {
            action: "adDeposit",
            underlying: wbtc,
            decimals: 8,
            outputToken: wbtc8,
          },
          {
            action: "adWithdraw",
            underlying: wbtc,
            decimals: 8,
            outputToken: wbtc,
          },
        ] as const;
        // reduce from 10 -> 1 since there is now a tx-wide CU limit
        const madness = Array(1)
          .fill(null)
          .flatMap(() => codon);

        // do the swap
        const userSDK = sdk.withSigner(user);
        const plan = userSDK.router.createPlan(
          new TokenAmount(wbtc, 10_000000),
          new TokenAmount(wbtc8, 10_00000000),
          [
            ...madness,
            {
              action: "adDeposit",
              underlying: wbtc,
              decimals: 8,
              outputToken: wbtc8,
            },
          ]
        );
        const tx = await plan.buildTX();
        console.log(await tx.simulate())
        await expectTX(tx, "execute plan").to.be.fulfilled;

        expect(await balanceOf(provider, wbtc, user)).to.tokenAmount.zero();
        expect(await balanceOf(provider, wbtc8, user)).to.tokenAmount.equal(
          new TokenAmount(wbtc8, 10_00000000)
        );
      });
    });

    describe("manual ADSSWithdrawOne", () => {
      it("works", async () => {
        const lpToken = new Token({
          chainId: 31337,
          name: "btcSwapLP",
          address: btcSwap.state.poolTokenMint.toString(),
          decimals: 8,
          symbol: "btcLP",
        });

        const expectedAmount = 10_000000;

        // mint tokens
        // get and set up the accounts
        // create 100 wbtc for the user
        await initATA(wbtc, user, {
          minter,
          mintAmount: expectedAmount,
        });

        // Deposit to swap
        const userSDK = sdk.withSigner(user);
        const plan = userSDK.router.createPlan(
          new TokenAmount(wbtc, expectedAmount),
          new TokenAmount(wbtc8, expectedAmount),
          [
            {
              action: "adDeposit",
              underlying: wbtc,
              decimals: 8,
              outputToken: wbtc8,
            },
          ]
        );
        let tx = await plan.buildTX();
        const { accounts, instructions } = await getOrCreateATAs({
          provider: userSDK.provider,
          mints: {
            sourceA: btcSwap.state.tokenA.mint,
            poolToken: btcSwap.state.poolTokenMint,
          },
          owner: user.publicKey,
        });
        // ATA for source B should be created in previous adDeposit instruction
        const sourceB = await getATAAddress({
          mint: btcSwap.state.tokenB.mint,
          owner: user.publicKey,
        });
        tx.instructions.push(...instructions);
        tx.instructions.push(
          btcSwap.deposit({
            userAuthority: user.publicKey,
            sourceA: accounts.sourceA,
            sourceB,
            poolTokenAccount: accounts.poolToken,
            tokenAmountA: new u64(0),
            tokenAmountB: new u64(expectedAmount),
            minimumPoolTokenAmount: new u64(0),
          })
        );
        await expectTX(tx, "deposit wrapped wbtc").to.be.fulfilled;

        const facadePlan = userSDK.router.createWithdrawOneActionFacade({
          swap: btcSwap,
          inputAmount: await balanceOf(provider, lpToken, user),
          minimumAmountOut: new TokenAmount(wbtc8, 0),
          adWithdrawAction: {
            action: "adWithdraw",
            underlying: wbtc,
            decimals: 8,
            outputToken: wbtc,
          },
        });
        tx = await facadePlan.manualSSWithdrawOne();
        await expectTX(tx, "manualSSWithdrawOne").to.be.fulfilled;

        const wbtc8Account = await getTokenAccount(provider, sourceB);
        expect(wbtc8Account.amount).to.bignumber.equal(new u64(99)); // Some dust

        const wbtcAccount = await getTokenAccount(
          provider,
          await getATAAddress({
            mint: new PublicKey(wbtc.address),
            owner: user.publicKey,
          })
        );
        expect(wbtcAccount.amount).to.bignumber.equal(
          new u64(expectedAmount).sub(new BN(1))
        );
      });
    });
  });
});
