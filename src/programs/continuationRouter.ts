import type { AnchorTypes } from "@saberhq/anchor-contrib";

import type { ContinuationRouterIDL } from "../idls/continuation_router";

export * from "../idls/continuation_router";

export type ContinuationRouterTypes = AnchorTypes<
  ContinuationRouterIDL,
  {
    continuation: ContinuationState;
  }
>;

export type ContinuationRouterError = ContinuationRouterTypes["Error"];

export type ContinuationRouterProgram = ContinuationRouterTypes["Program"];

export type ContinuationRouterEvents = ContinuationRouterTypes["Events"];

export type ContinuationRouterAccounts = ContinuationRouterTypes["Accounts"];

export type ContinuationState = ContinuationRouterAccounts["Continuation"];

export type SwapCompleteEvent = ContinuationRouterEvents["SwapCompleteEvent"];

export { ContinuationRouterJSON } from "../idls/continuation_router";
