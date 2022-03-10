import type { AnchorTypes } from "@saberhq/anchor-contrib";

import type { RedeemerIDL } from "../idls/redeemer";

export * from "../idls/redeemer";

export type RedeemerTypes = AnchorTypes<
  RedeemerIDL,
  {
    redeemer: RedeemerData;
  }
>;

type Accounts = RedeemerTypes["Accounts"];
export type RedeemerData = Accounts["Redeemer"];

export type RedeemerEvents = RedeemerTypes["Events"];
export type RedeemerProgram = RedeemerTypes["Program"];
