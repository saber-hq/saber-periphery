import type { AnchorTypes } from "@saberhq/anchor-contrib";

import type { AddDecimalsIDL } from "../idls/add_decimals";

export * from "../idls/add_decimals";

export type AddDecimalsTypes = AnchorTypes<
  AddDecimalsIDL,
  {
    wrappedToken: WrappedTokenData;
  }
>;

type Accounts = AddDecimalsTypes["Accounts"];
export type WrappedTokenData = Accounts["WrappedToken"];

export type AddDecimalsProgram = AddDecimalsTypes["Program"];

export type UserStakeAccounts = Parameters<
  AddDecimalsProgram["instruction"]["deposit"]["accounts"]
>[0];

export { AddDecimalsJSON } from "../idls/add_decimals";
