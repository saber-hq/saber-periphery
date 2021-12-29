import type { Network } from "@saberhq/solana-contrib";
import type { Price, Token, TokenAmount } from "@saberhq/token-utils";
import { ZERO } from "@saberhq/token-utils";
import JSBI from "jsbi";
import invariant from "tiny-invariant";

import type { Action } from "../../wrappers/actionPlan";
import { WrappedToken } from "../wrappedToken";
import { pairFromWrappedToken } from "./addDecimals";
import type { StableSwapPool } from "./stableSwap";
import { pairFromStableSwap } from "./stableSwap";
import type { PoolOutputResult, PoolStrategy } from "./strategy";

export * from "./strategy";

/**
 * Represents a swap pair.
 *
 * A pair consists of two parts:
 * - the underlying pool, and
 * - the strategy, which determines how the pool should be traded.
 *
 * Unlike UniswapV2, there may be multiple pairs for a given set of two tokens.
 * For example: there could exist both a StableSwap and a CP-AMM pair for two
 * tokens. It is up to the trade calculator to determine
 */
export class Pair<P = unknown> {
  /**
   *
   * @param pool underlying pool object
   * @param reserves
   * @param liquidityToken
   * @param strategy
   */
  constructor(readonly pool: P, readonly strategy: PoolStrategy<P>) {}

  /**
   * Returns true if the token is either token0 or token1
   * @param token to check
   */
  involvesToken(token: Token): boolean {
    return token.equals(this.token0) || token.equals(this.token1);
  }

  /**
   * Returns the current mid price of the pair in terms of token0, i.e. the ratio of reserve1 to reserve0
   */
  get token0Price(): Price {
    return this.token1Price.invert();
  }

  /**
   * Returns the current mid price of the pair in terms of token1, i.e. the ratio of reserve0 to reserve1
   */
  get token1Price(): Price {
    return this.strategy.getPriceOfToken1(this.pool);
  }

  /**
   * Return the price of the given token in terms of the other token in the pair.
   * @param token token to return price of
   */
  priceOf(token: Token): Price {
    invariant(this.involvesToken(token), "TOKEN");
    return token.equals(this.token0) ? this.token0Price : this.token1Price;
  }

  /**
   * Returns the chain ID of the tokens in the pair.
   */
  get network(): Network {
    return this.token0.network;
  }

  get token0(): Token {
    return this.strategy.getToken0(this.pool);
  }

  get token1(): Token {
    return this.strategy.getToken1(this.pool);
  }

  hasZeroLiquidity(): boolean {
    return this.strategy.hasZeroLiquidity(this.pool);
  }

  getOutputAmount(
    inputAmount: TokenAmount
  ): Omit<PoolOutputResult<P>, "pair"> & { pair: AnyPair } {
    invariant(this.involvesToken(inputAmount.token), "TOKEN");
    if (this.hasZeroLiquidity()) {
      throw new Error("insufficient pool liquidity");
    }
    const {
      amount: outputAmount,
      fees,
      pair: nextPair,
    } = this.strategy.getOutputAmount(this.pool, inputAmount);
    if (JSBI.EQ(outputAmount.raw, ZERO)) {
      throw new Error("insufficient input amount");
    }
    return { amount: outputAmount, fees, pair: nextPair as AnyPair };
  }

  asAction(outputToken: Token): Action {
    return this.strategy.asAction(this.pool, outputToken);
  }

  isStableSwapPair(): this is Pair<StableSwapPool> {
    return "config" in this.pool && "exchange" in this.pool;
  }

  isWrappedPair(): this is Pair<WrappedToken> {
    return this.pool instanceof WrappedToken;
  }

  static fromWrappedToken = pairFromWrappedToken;
  static fromStableSwap = pairFromStableSwap;

  toString(): string {
    return `Pair[token0=${this.token0.toString()}, token1=${this.token1.toString()}]`;
  }
}

export type AnyPair = Omit<Pair<unknown>, "pool">;
