import type { AnchorTypes } from "@saberhq/anchor-contrib";

import type { LockupIDL } from "../idls/lockup";

export * from "../idls/lockup";

export type LockupTypes = AnchorTypes<
  LockupIDL,
  {
    release: ReleaseData;
  }
>;

type Accounts = LockupTypes["Accounts"];
export type ReleaseData = Accounts["Release"];

export type LockupProgram = LockupTypes["Program"];

export { LockupJSON } from "../idls/lockup";
