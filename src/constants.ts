import { buildCoderMap } from "@saberhq/anchor-contrib";
import { PublicKey } from "@solana/web3.js";

import { RedeemerJSON } from "./idls/redeemer";
import type {
  AddDecimalsProgram,
  AddDecimalsTypes,
  ContinuationRouterProgram,
  ContinuationRouterTypes,
  LockupProgram,
  LockupTypes,
  MintProxyProgram,
  MintProxyTypes,
} from "./programs";
import {
  AddDecimalsJSON,
  ContinuationRouterJSON,
  LockupJSON,
  MintProxyJSON,
} from "./programs";
import type { RedeemerProgram, RedeemerTypes } from "./programs/redeemer";

/**
 * Addresses of Saber programs deployed on `devnet` and `mainnet-beta`.
 */
export const SABER_ADDRESSES = {
  AddDecimals: new PublicKey("DecZY86MU5Gj7kppfUCEmd4LbXXuyZH1yHaP2NTqdiZB"),
  ContinuationRouter: new PublicKey(
    "Crt7UoUR6QgrFrN7j8rmSQpUTNWNSitSwWvsWGf1qZ5t"
  ),
  Lockup: new PublicKey("LockKXdYQVMbhhckwH3BxoYJ9FYatcZjwNGEuCwY33Q"),
  MintProxy: new PublicKey("UBEBk5idELqykEEaycYtQ7iBVrCg6NmvFSzMpdr22mL"),
  Redeemer: new PublicKey("RDM23yr8pr1kEAmhnFpaabPny6C9UVcEcok3Py5v86X"),
} as const;

/**
 * IDLs of Saber programs.
 */
export const SABER_IDLS = {
  AddDecimals: AddDecimalsJSON,
  ContinuationRouter: ContinuationRouterJSON,
  Lockup: LockupJSON,
  MintProxy: MintProxyJSON,
  Redeemer: RedeemerJSON,
} as const;

/**
 * Saber program types.
 */
export interface SaberPrograms {
  AddDecimals: AddDecimalsProgram;
  ContinuationRouter: ContinuationRouterProgram;
  Lockup: LockupProgram;
  MintProxy: MintProxyProgram;
  Redeemer: RedeemerProgram;
}

/**
 * Saber coders.
 */
export const SABER_CODERS = buildCoderMap<{
  AddDecimals: AddDecimalsTypes;
  ContinuationRouter: ContinuationRouterTypes;
  Lockup: LockupTypes;
  MintProxy: MintProxyTypes;
  Redeemer: RedeemerTypes;
}>(SABER_IDLS, SABER_ADDRESSES);

/**
 * Mint of the Saber IOU token.
 */
export const SABER_IOU_MINT = new PublicKey(
  "iouQcQBAiEXe6cKLS85zmZxUqaCqBdeHFpqKoSz615u"
);

/**
 * Key of the Saber Redeemer.
 */
export const SABER_REDEEMER_KEY = new PublicKey(
  "CL9wkGFT3SZRRNa9dgaovuRV7jrVVigBUZ6DjcgySsCU"
);

/**
 * Mint of the Saber Protocol Token.
 */
export const SBR_MINT = "Saber2gLauYim4Mvftnrasomsv6NvAuncvMEZwcLpD1";

/**
 * {@link PublicKey} of the Saber Protocol Token.
 */
export const SBR_ADDRESS = new PublicKey(SBR_MINT);

/**
 * Address of the Mint Proxy state account.
 */
export const MINT_PROXY_STATE = new PublicKey(
  "9qRjwMQYrkd5JvsENaYYxSCgwEuVhK4qAo5kCFHSmdmL"
);

/**
 * Address of the mint authority of the SBR token.
 */
export const MINT_PROXY_AUTHORITY = new PublicKey(
  "GyktbGXbH9kvxP8RGfWsnFtuRgC7QCQo2WBqpo3ryk7L"
);
