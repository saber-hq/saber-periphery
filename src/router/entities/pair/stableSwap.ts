import type {
  IExchangeInfo,
  StableSwapConfig,
  StableSwapState,
} from "@saberhq/stableswap-sdk";
import {
  calculateEstimatedSwapOutputAmount,
  StableSwap,
} from "@saberhq/stableswap-sdk";
import { Price, TokenAmount } from "@saberhq/token-utils";
import BN from "bn.js";

import type { PoolStrategy } from ".";
import { Pair } from ".";

export interface StableSwapPool {
  config: StableSwapConfig;
  state: StableSwapState;
  exchange: IExchangeInfo;
}

const poolStrategy: PoolStrategy<StableSwapPool> = {
  getOutputAmount: ({ exchange, ...rest }, inputAmount) => {
    const out = calculateEstimatedSwapOutputAmount(exchange, inputAmount);
    return {
      amount: out.outputAmount,
      fees: out.fee,
      pair: pairFromStableSwap({
        ...rest,
        exchange: {
          ...exchange,
          reserves: out.outputAmount.token.equals(
            exchange.reserves[0].amount.token
          )
            ? [
                {
                  ...exchange.reserves[0],
                  amount: exchange.reserves[0].amount.subtract(
                    out.outputAmount
                  ),
                },
                {
                  ...exchange.reserves[1],
                  amount: exchange.reserves[1].amount.add(inputAmount),
                },
              ]
            : [
                {
                  ...exchange.reserves[0],
                  amount: exchange.reserves[0].amount.add(inputAmount),
                },
                {
                  ...exchange.reserves[1],
                  amount: exchange.reserves[1].amount.subtract(
                    out.outputAmount
                  ),
                },
              ],
        },
      }),
    };
  },
  getPriceOfToken1: ({ exchange }) => {
    const reserve0 = exchange.reserves[0].amount;
    const reserve1 = exchange.reserves[1].amount;

    // We try to get at least 4 decimal points of precision here
    // Otherwise, we attempt to swap 1% of total supply of the pool
    // or at most, $1
    const inputAmountNum = Math.max(
      10_000,
      Math.min(
        10 ** reserve0.token.decimals,
        Math.floor(parseInt(reserve0.toU64().div(new BN(100)).toString()))
      )
    );

    const inputAmount = new TokenAmount(reserve0.token, inputAmountNum);
    const outputAmount = calculateEstimatedSwapOutputAmount(
      exchange,
      inputAmount
    );

    const frac = outputAmount.outputAmountBeforeFees.asFraction.divide(
      inputAmount.asFraction
    );

    return new Price(
      reserve0.token,
      reserve1.token,
      frac.denominator,
      frac.numerator
    );
  },
  hasZeroLiquidity: ({ exchange }) => {
    return (
      exchange.reserves[0].amount.equalTo(0) ||
      exchange.reserves[1].amount.equalTo(0)
    );
  },

  getToken0: ({ exchange }) => exchange.reserves[0].amount.token,
  getToken1: ({ exchange }) => exchange.reserves[1].amount.token,

  asAction: (pool, outputToken) => ({
    swap: new StableSwap(pool.config, pool.state),
    action: "ssSwap",
    outputToken,
  }),
};

export const pairFromStableSwap = (
  pool: StableSwapPool
): Pair<StableSwapPool> => {
  return new Pair(pool, poolStrategy);
};
