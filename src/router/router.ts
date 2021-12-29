import type { AugmentedProvider } from "@saberhq/solana-contrib";
import type { StableSwap } from "@saberhq/stableswap-sdk";
import type { Token, TokenAmount } from "@saberhq/token-utils";
import invariant from "tiny-invariant";

import type { SaberPrograms } from "../constants";
import type { Trade } from "./entities/trade";
import type { Action } from "./wrappers/actionPlan";
import { ActionPlan } from "./wrappers/actionPlan";
import { WrappedTokenActions } from "./wrappers/wrappedTokenActions";

/**
 * Saber Router SDK.
 */
export class Router {
  constructor(
    readonly provider: AugmentedProvider,
    readonly programs: SaberPrograms
  ) {}

  createPlan(
    inputAmount: TokenAmount,
    minimumAmountOut: TokenAmount,
    actions: Action[]
  ): ActionPlan {
    return new ActionPlan(this, inputAmount, minimumAmountOut, actions);
  }

  /**
   * Plans a trade, returning an executable Action Plan which uses the continuation
   * router to perform the desired sequence of swaps ("actions") atomically.
   *
   * @param trade
   * @param minimumAmountOut
   * @returns
   */
  planTrade(trade: Trade, minimumAmountOut: TokenAmount): ActionPlan {
    return new ActionPlan(
      this,
      trade.inputAmount,
      minimumAmountOut,
      trade.route.pairs.map((pair, i) => {
        const outputToken = trade.route.path[i + 1];
        invariant(outputToken, "no output token");
        return pair.asAction(outputToken);
      })
    );
  }

  /**
   * Loads a decimal wrapped token
   * @param underlying
   * @param decimals
   * @returns
   */
  async loadWrappedToken(
    underlying: Token,
    decimals: number
  ): Promise<WrappedTokenActions> {
    return await WrappedTokenActions.loadWithActions(
      this.provider,
      this.programs.AddDecimals,
      underlying,
      decimals
    );
  }

  /**
   * Creates a WithdrawOne action.
   * @returns
   */
  createWithdrawOneActionFacade({
    swap,
    inputAmount,
    minimumAmountOut,
    adWithdrawAction,
  }: {
    swap: StableSwap;
    inputAmount: TokenAmount;
    minimumAmountOut: TokenAmount;
    adWithdrawAction?: Action;
  }): ActionPlan {
    const actions: Action[] = [
      {
        swap,
        action: "ssWithdrawOne",
        outputToken: minimumAmountOut.token,
      },
    ];
    if (adWithdrawAction) {
      actions.push(adWithdrawAction);
    }
    return new ActionPlan(this, inputAmount, minimumAmountOut, actions);
  }
}
