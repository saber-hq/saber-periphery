/// <reference types="mocha" />

import * as anchor from "@project-serum/anchor";
import { assertError, expectTX } from "@saberhq/chai-solana";
import * as serumCmn from "@saberhq/token-utils";
import { getOrCreateATA, u64 } from "@saberhq/token-utils";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as assert from "assert";
import { expect } from "chai";
import invariant from "tiny-invariant";

import type { LockupError, ReleaseData } from "../src";
import { LockupErrors } from "../src";
import { getRewardsMint } from "./_beforeAll.spec";
import { DEFAULT_HARD_CAP, makeSDK } from "./workspace";

describe("MintProxy", () => {
  const sdk = makeSDK();
  const { provider } = sdk;
  const { BN, web3 } = anchor;
  const { mintProxy, lockup } = sdk;
  const { MintProxy, Lockup } = sdk.programs;

  let mint: PublicKey;

  before(() => {
    mint = getRewardsMint();
  });

  it("Check MintProxy", async () => {
    const { proxyAuthority } = await mintProxy.new({
      hardcap: DEFAULT_HARD_CAP,
      mintAuthority: provider.wallet.publicKey,
      tokenMint: mint,
    });

    const mintInfo = await serumCmn.getMintInfo(provider, mint);
    assert.ok(mintInfo.mintAuthority?.equals(proxyAuthority));

    const mintProxyState = await MintProxy.state.fetch();
    expect(mintProxyState.hardCap).to.bignumber.eq(DEFAULT_HARD_CAP);
    assert.ok(mintProxyState.proxyMintAuthority.equals(proxyAuthority));
    assert.ok(mintProxyState.owner.equals(provider.wallet.publicKey));
    assert.ok(mintProxyState.tokenMint.equals(mint));
    assert.ok(
      mintProxyState.stateAssociatedAccount.equals(MintProxy.state.address())
    );
  });

  describe("MintProxy", () => {
    it("Transfer super authority and accept super authority", async () => {
      const newAuthority = web3.Keypair.generate();

      await assert.doesNotReject(async () => {
        await MintProxy.state.rpc.transferOwnership(newAuthority.publicKey, {
          accounts: {
            owner: provider.wallet.publicKey,
          },
        });
      });

      let mintProxyState = await mintProxy.program.state.fetch();
      expect(
        mintProxyState.owner.toString(),
        provider.wallet.publicKey.toString()
      );
      expect(
        mintProxyState.pendingOwner.toString(),
        newAuthority.publicKey.toString()
      );

      const ix = mintProxy.program.state.instruction.acceptOwnership({
        accounts: {
          owner: newAuthority.publicKey,
        },
      });
      let tx = sdk.newTx([ix], [newAuthority]);
      await expectTX(tx, "transfer authority").to.be.fulfilled;
      mintProxyState = await mintProxy.program.state.fetch();
      expect(
        mintProxyState.owner.toString(),
        newAuthority.publicKey.toString()
      );
      expect(
        mintProxyState.pendingOwner.toString(),
        web3.PublicKey.default.toString()
      );

      // Transfer back
      const instructions = [];
      instructions.push(
        mintProxy.program.state.instruction.transferOwnership(
          provider.wallet.publicKey,
          {
            accounts: {
              owner: newAuthority.publicKey,
            },
          }
        )
      );
      instructions.push(
        mintProxy.program.state.instruction.acceptOwnership({
          accounts: {
            owner: provider.wallet.publicKey,
          },
        })
      );

      tx = sdk.newTx(instructions, [newAuthority]);
      await expectTX(tx, "transfer authority back to original authority").to.be
        .fulfilled;

      mintProxyState = await mintProxy.program.state.fetch();
      expect(
        mintProxyState.owner.toString(),
        provider.wallet.publicKey.toString()
      );
      expect(
        mintProxyState.pendingOwner.toString(),
        web3.PublicKey.default.toString()
      );
    });

    it("Adds to the whitelist", async () => {
      const allowance = new u64(1_000_000);
      const id = Keypair.generate().publicKey;
      await expectTX(mintProxy.minterAdd(id, allowance), "add minter").to.be
        .fulfilled;
      expect(
        (await mintProxy.fetchMinterInfo(id))?.allowance,
        "allowance"
      ).to.bignumber.eq(allowance);
    });

    it("Removes from the whitelist", async () => {
      const allowance = new u64(1_000_000);
      const id = Keypair.generate().publicKey;
      await expectTX(mintProxy.minterAdd(id, allowance), "add minter").to.be
        .fulfilled;

      expect(
        (await mintProxy.fetchMinterInfo(id))?.allowance,
        "allowance"
      ).to.bignumber.eq(allowance);

      await expectTX(mintProxy.minterRemove(id), "remove minter").to.be
        .fulfilled;
      expect(await mintProxy.fetchMinterInfo(id), "no more allowance").to.be
        .null;
    });
  });

  describe("Lockup", () => {
    const RELEASE_AMOUNT = new BN(1000);

    let beneficiary: Keypair;
    let releaseAccount: ReleaseData;

    beforeEach("Setup beneficiary account", async () => {
      beneficiary = Keypair.generate();
      const signature = await provider.connection.requestAirdrop(
        beneficiary.publicKey,
        web3.LAMPORTS_PER_SOL * 3
      );
      await provider.connection.confirmTransaction(signature);
    });

    it("Initialize lockup", async () => {
      await assert.doesNotReject(async () => {
        await Lockup.state.rpc.new({
          accounts: {
            auth: { owner: provider.wallet.publicKey },
            mintProxyState: MintProxy.state.address(),
            mintProxyProgram: MintProxy.programId,
          },
        });
      });

      const lockupAccount = await Lockup.state.fetch();
      assert.ok(lockupAccount.owner.equals(provider.wallet.publicKey));
      assert.ok(lockupAccount.pendingOwner.equals(PublicKey.default));
    });

    it("Sets a new authority", async () => {
      const newAuthority = anchor.web3.Keypair.generate();
      await Lockup.state.rpc.transferOwnership(newAuthority.publicKey, {
        accounts: {
          owner: provider.wallet.publicKey,
        },
      });
      assert.ok(
        (await Lockup.state.fetch()).owner.equals(provider.wallet.publicKey)
      );
      await Lockup.state.rpc.acceptOwnership({
        accounts: {
          owner: newAuthority.publicKey,
        },
        signers: [newAuthority],
      });

      let lockupAccount = await Lockup.state.fetch();
      assert.ok(lockupAccount.owner.equals(newAuthority.publicKey));

      await Lockup.state.rpc.transferOwnership(provider.wallet.publicKey, {
        accounts: {
          owner: newAuthority.publicKey,
        },
        signers: [newAuthority],
      });
      assert.ok(
        (await Lockup.state.fetch()).owner.equals(newAuthority.publicKey)
      );
      await Lockup.state.rpc.acceptOwnership({
        accounts: {
          owner: provider.wallet.publicKey,
        },
      });

      lockupAccount = await Lockup.state.fetch();
      assert.ok(lockupAccount.owner.equals(provider.wallet.publicKey));
    });

    it("Creates a release account", async () => {
      const startTs = new BN(Date.now() / 1000);
      const endTs = new BN(startTs.toNumber() + 5);

      const { tx } = await lockup.createReleaseForBeneficiary({
        amount: RELEASE_AMOUNT,
        startTs,
        endTs,
        beneficiary: beneficiary.publicKey,
      });
      await expectTX(tx, "Create release account").to.be.fulfilled;

      releaseAccount = await Lockup.account.release.associated(
        beneficiary.publicKey
      );

      assert.ok(releaseAccount.beneficiary.equals(beneficiary.publicKey));
      assert.ok(releaseAccount.outstanding.eq(RELEASE_AMOUNT));
      assert.ok(releaseAccount.startBalance.eq(RELEASE_AMOUNT));
      assert.ok(releaseAccount.createdTs.gt(new BN(0)));
      assert.ok(releaseAccount.startTs.eq(startTs));
      assert.ok(releaseAccount.endTs.eq(endTs));
    });

    it("Revoke lockup", async () => {
      const startTs = new BN(Date.now() / 1000);
      const endTs = new BN(startTs.toNumber() + 5);

      const { tx, release } = await lockup.createReleaseForBeneficiary({
        amount: RELEASE_AMOUNT,
        startTs,
        endTs,
        beneficiary: beneficiary.publicKey,
      });
      await expectTX(tx, "Create release account").to.be.fulfilled;

      releaseAccount = await Lockup.account.release.associated(
        beneficiary.publicKey
      );

      assert.ok(releaseAccount.beneficiary.equals(beneficiary.publicKey));
      assert.ok(releaseAccount.outstanding.eq(RELEASE_AMOUNT));
      assert.ok(releaseAccount.startBalance.eq(RELEASE_AMOUNT));
      assert.ok(releaseAccount.createdTs.gt(new BN(0)));
      assert.ok(releaseAccount.startTs.eq(startTs));
      assert.ok(releaseAccount.endTs.eq(endTs));

      const { tx: revokeTX } = await lockup.revokeReleaseForBeneficiary({
        beneficiary: beneficiary.publicKey,
      });
      await expectTX(revokeTX, "Revoke release").to.be.fulfilled;

      const releaseData = await provider.connection.getAccountInfo(release);
      expect(releaseData, "release deleted").to.be.null;
    });

    describe("Withdraw", () => {
      let beneficiaryTokenAccountAddress: PublicKey;

      beforeEach("Create token account for beneficiary", async () => {
        const { address, instruction } = await getOrCreateATA({
          provider,
          mint,
          owner: beneficiary.publicKey,
          payer: beneficiary.publicKey,
        });

        if (instruction) {
          const tx = sdk.newTx([instruction], [beneficiary]);
          await expectTX(tx, "create associated token account").to.be.fulfilled;
        }

        beneficiaryTokenAccountAddress = address;
      });

      it("Fails to withdraw from a release account before release", async () => {
        const tx = await lockup.withdraw();
        await assert.rejects(async () => {
          await tx.confirm(),
            (err: LockupError) => {
              assertError(err, LockupErrors.InsufficientWithdrawalBalance);
              return true;
            };
        });
      });

      it("Fails to withdraw from a release account before release with amount", async () => {
        const tx = await lockup.withdraw(
          provider.wallet.publicKey,
          new BN(100)
        );
        await assert.rejects(async () => {
          await tx.confirm(),
            (err: LockupError) => {
              assertError(err, LockupErrors.InsufficientWithdrawalBalance);
              return true;
            };
        });
      });

      it("Withdraws from the release account", async () => {
        const startTs = new BN(Math.floor(Date.now() / 1000));
        const endTs = new BN(startTs.toNumber() + 5);
        const { tx: createTx } = await lockup.createReleaseForBeneficiary({
          amount: RELEASE_AMOUNT,
          startTs,
          endTs,
          beneficiary: beneficiary.publicKey,
        });
        await expectTX(createTx, "create release").to.be.fulfilled;

        const initialReleaseAccount = await lockup.fetchRelease(
          beneficiary.publicKey
        );
        invariant(initialReleaseAccount);
        expect(initialReleaseAccount.startBalance).to.bignumber.eq(
          RELEASE_AMOUNT
        );
        expect(initialReleaseAccount.outstanding).to.bignumber.eq(
          RELEASE_AMOUNT
        );

        const initialTokenAccount = await serumCmn.getTokenAccount(
          provider,
          beneficiaryTokenAccountAddress
        );
        expect(initialTokenAccount.amount).to.bignumber.eq(new BN(0));

        // wait for withdrawal to fully release
        await serumCmn.sleep(6 * 1_000);

        await expectTX(
          (
            await lockup.withdraw(beneficiary.publicKey)
          ).addSigners(beneficiary),
          "withdraw"
        ).to.be.fulfilled;

        const finalReleaseAccount = await lockup.fetchRelease(
          beneficiary.publicKey
        );
        invariant(finalReleaseAccount);
        expect(finalReleaseAccount.startBalance).to.bignumber.eq(
          RELEASE_AMOUNT
        );
        expect(finalReleaseAccount.outstanding).to.bignumber.eq(new BN(0));

        const finalTokenAccount = await serumCmn.getTokenAccount(
          provider,
          beneficiaryTokenAccountAddress
        );
        expect(finalTokenAccount.amount).to.bignumber.eq(RELEASE_AMOUNT);
      });

      it("Withdraws from the release account with amount", async () => {
        const startTs = new BN(Math.floor(Date.now() / 1000));
        const endTs = new BN(startTs.toNumber() + 5);
        const { tx: createTx } = await lockup.createReleaseForBeneficiary({
          amount: RELEASE_AMOUNT,
          startTs,
          endTs,
          beneficiary: beneficiary.publicKey,
        });
        await expectTX(createTx, "create release").to.be.fulfilled;

        const initialReleaseAccount = await lockup.fetchRelease(
          beneficiary.publicKey
        );
        invariant(initialReleaseAccount);
        expect(initialReleaseAccount.startBalance).to.bignumber.eq(
          RELEASE_AMOUNT
        );
        expect(initialReleaseAccount.outstanding).to.bignumber.eq(
          RELEASE_AMOUNT
        );

        const initialTokenAccount = await serumCmn.getTokenAccount(
          provider,
          beneficiaryTokenAccountAddress
        );
        expect(initialTokenAccount.amount).to.bignumber.eq(new BN(0));

        // wait for withdraw amount to release
        await serumCmn.sleep(2 * 1_000);

        const withdrawAmount = new BN(200);
        const tx = (
          await lockup.withdraw(beneficiary.publicKey, withdrawAmount)
        ).addSigners(beneficiary);

        await expectTX(tx, "withdraw").to.be.fulfilled;

        const finalReleaseAccount = await lockup.fetchRelease(
          beneficiary.publicKey
        );
        invariant(finalReleaseAccount);
        expect(finalReleaseAccount.startBalance).to.bignumber.eq(
          RELEASE_AMOUNT
        );
        expect(finalReleaseAccount.outstanding).to.bignumber.eq(
          RELEASE_AMOUNT.sub(withdrawAmount)
        );

        const finalTokenAccount = await serumCmn.getTokenAccount(
          provider,
          beneficiaryTokenAccountAddress
        );
        expect(finalTokenAccount.amount).to.bignumber.eq(withdrawAmount);

        // Withdrawing again should fail
        const withdrawAgainTx = await lockup.withdraw(
          provider.wallet.publicKey,
          withdrawAmount
        );
        await assert.rejects(async () => {
          await withdrawAgainTx.confirm(),
            (err: LockupError) => {
              assertError(err, LockupErrors.InsufficientWithdrawalBalance);
              return true;
            };
        });
      });
    });
  });
});
