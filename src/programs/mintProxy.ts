import type { AnchorTypes } from "@saberhq/anchor-contrib";

import type { MintProxyIDL } from "../idls/mint_proxy";

export * from "../idls/mint_proxy";

export type MintProxyTypes = AnchorTypes<
  MintProxyIDL,
  {
    minterInfo: MinterInfo;
    mintProxyInfo: MintProxyInfo;
  }
>;

export type MintProxyInfo = MintProxyTypes["State"];

type Accounts = MintProxyTypes["Accounts"];
export type MinterInfo = Accounts["MinterInfo"];

export type MintProxyError = MintProxyTypes["Error"];

export type MintProxyProgram = MintProxyTypes["Program"];
