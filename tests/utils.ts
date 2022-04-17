import { AnchorProvider } from "@project-serum/anchor";
import type { SwapTokenInfo } from "@saberhq/stableswap-sdk";
import type { Token } from "@saberhq/token-utils";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SPLToken,
  TOKEN_PROGRAM_ID,
} from "@saberhq/token-utils";
import type { PublicKey, Signer } from "@solana/web3.js";
import { Transaction } from "@solana/web3.js";
import { expect } from "chai";

export const initATA = async (
  token: Token,
  owner: Signer,
  mint?: { minter: Signer; mintAmount: number }
): Promise<PublicKey> => {
  const account = await SPLToken.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    token.mintAccount,
    owner.publicKey
  );

  const tx = new Transaction().add(
    SPLToken.createAssociatedTokenAccountInstruction(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      token.mintAccount,
      account,
      owner.publicKey,
      AnchorProvider.env().wallet.publicKey
    )
  );

  if (mint) {
    tx.add(
      SPLToken.createMintToInstruction(
        TOKEN_PROGRAM_ID,
        token.mintAccount,
        account,
        mint.minter.publicKey,
        [],
        mint.mintAmount
      )
    );
  }
  // mint tokens
  await AnchorProvider.env().sendAndConfirm(
    tx,
    mint ? [mint.minter] : undefined,
    {
      commitment: "confirmed",
    }
  );
  return account;
};

export const assertSwapTokenInfo = (
  actual: SwapTokenInfo,
  expected: SwapTokenInfo
): void => {
  expect(actual.adminFeeAccount.toString()).to.eq(
    expected.adminFeeAccount.toString()
  );
  expect(actual.mint.toString()).to.eq(expected.mint.toString());
  expect(actual.reserve.toString()).to.eq(expected.reserve.toString());
};
