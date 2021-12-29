import * as anchor from "@project-serum/anchor";
import { makeSaberProvider } from "@saberhq/anchor-contrib";
import { chaiSolana } from "@saberhq/chai-solana";
import type { Provider } from "@saberhq/solana-contrib";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getTokenAccount,
  SPLToken,
  Token,
  TOKEN_PROGRAM_ID,
  TokenAmount,
  u64,
} from "@saberhq/token-utils";
import type { PublicKey, Signer } from "@solana/web3.js";
import chai from "chai";

import type { SaberPrograms } from "../src/constants";
import { Saber } from "../src/sdk";

chai.use(chaiSolana);

export type Workspace = SaberPrograms;

export const DEFAULT_DECIMALS = 6;
export const DEFAULT_HARD_CAP = new u64("10000000000000000"); // 10 billion
export const LOCAL_CHAIN_ID = 100;

export const makeSDK = (): Saber => {
  const ANCHOR_PROVIDER_URL = process.env.ANCHOR_PROVIDER_URL;
  if (!ANCHOR_PROVIDER_URL) {
    throw new Error("no anchor provider URL");
  }
  const anchorProvider = anchor.getProvider();
  // if the program isn't loaded, load the default
  const provider = makeSaberProvider(anchorProvider);
  return Saber.load({ provider });
};

export const balanceOf = async (
  provider: Provider,
  token: Token,
  owner: PublicKey | Signer
): Promise<TokenAmount> => {
  const account = await SPLToken.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    token.mintAccount,
    "publicKey" in owner ? owner.publicKey : owner
  );
  const result = await getTokenAccount(provider, account);
  return new TokenAmount(token, result.amount);
};

/**
 * Creates a token for testing purposes.
 * @param name
 * @param symbol
 * @param decimals
 * @param minter
 * @returns
 */
export const createTestToken = async (
  provider: Provider,
  name: string,
  symbol: string,
  decimals: number,
  minter: Signer
): Promise<Token> => {
  const mint = await createMint(provider, minter.publicKey, decimals);
  return new Token({
    name,
    address: mint.toString(),
    decimals,
    chainId: 31337,
    symbol,
  });
};
