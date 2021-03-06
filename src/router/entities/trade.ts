import type { Token } from "@saberhq/token-utils";
import {
  Fraction,
  ONE,
  Percent,
  Price,
  TokenAmount,
  ZERO,
} from "@saberhq/token-utils";
import invariant from "tiny-invariant";

import { sortedInsert } from "../utils/sortedInsert";
import type { AnyPair } from "./pair";
import { Route } from "./route";

/**
 * Returns the percent difference between the mid price and the execution price, i.e. price impact.
 * @param midPrice mid price before the trade
 * @param inputAmount the input amount of the trade
 * @param outputAmount the output amount of the trade
 */
function computePriceImpact(
  midPrice: Price,
  inputAmount: TokenAmount,
  outputAmount: TokenAmount
): Percent {
  const exactQuoteFrac = midPrice.quote(inputAmount).asFraction;
  // calculate slippage := (exactQuote - outputAmount) / exactQuote
  const slippage = exactQuoteFrac
    .subtract(outputAmount.asFraction)
    .divide(exactQuoteFrac);
  return new Percent(slippage.numerator, slippage.denominator);
}

// minimal interface so the input output comparator may be shared across types
interface InputOutput {
  readonly inputAmount: TokenAmount;
  readonly outputAmount: TokenAmount;
}

// comparator function that allows sorting trades by their output amounts, in decreasing order, and then input amounts
// in increasing order. i.e. the best trades have the most outputs for the least inputs and are sorted first
export function inputOutputComparator(a: InputOutput, b: InputOutput): number {
  // must have same input and output token for comparison
  invariant(a.inputAmount.token.equals(b.inputAmount.token), "INPUT_CURRENCY");
  invariant(
    a.outputAmount.token.equals(b.outputAmount.token),
    "OUTPUT_CURRENCY"
  );
  if (a.outputAmount.equalTo(b.outputAmount)) {
    if (a.inputAmount.equalTo(b.inputAmount)) {
      return 0;
    }
    // trade A requires less input than trade B, so A should come first
    if (a.inputAmount.lessThan(b.inputAmount)) {
      return -1;
    } else {
      return 1;
    }
  } else {
    // tradeA has less output than trade B, so should come second
    if (a.outputAmount.lessThan(b.outputAmount)) {
      return 1;
    } else {
      return -1;
    }
  }
}

// extension of the input output comparator that also considers other dimensions of the trade in ranking them
export function tradeComparator(a: Trade, b: Trade): number {
  const ioComp = inputOutputComparator(a, b);
  if (ioComp !== 0) {
    return ioComp;
  }

  // consider lowest slippage next, since these are less likely to fail
  if (a.priceImpact.lessThan(b.priceImpact)) {
    return -1;
  } else if (a.priceImpact.greaterThan(b.priceImpact)) {
    return 1;
  }

  // finally consider the number of hops since each hop costs gas
  return a.route.path.length - b.route.path.length;
}

export interface BestTradeOptions {
  // how many results to return
  maxNumResults?: number;
  // the maximum number of hops a trade should contain
  maxHops?: number;
}

/**
 * Represents a trade executed against a list of pairs.
 * Does not account for slippage, i.e. trades that front run this trade and move the price.
 */
export class Trade {
  /**
   * The route of the trade, i.e. which pairs the trade goes through.
   */
  readonly route: Route;
  /**
   * The input amount for the trade assuming no slippage.
   */
  readonly inputAmount: TokenAmount;
  /**
   * The output amount for the trade assuming no slippage.
   */
  readonly outputAmount: TokenAmount;
  /**
   * The price expressed in terms of output amount/input amount.
   */
  readonly executionPrice: Price;
  /**
   * The mid price after the trade executes assuming no slippage.
   */
  readonly nextMidPrice: Price;
  /**
   * The percent difference between the mid price before the trade and the trade execution price.
   */
  readonly priceImpact: Percent;
  /**
   * Fees paid to the pairs.
   */
  readonly fees: readonly TokenAmount[];

  /**
   * Constructs an exact in trade with the given amount in and route
   * @param route route of the exact in trade
   * @param amountIn the amount being passed in
   */
  static exactIn(route: Route, amountIn: TokenAmount): Trade {
    return new Trade(route, amountIn);
  }

  constructor(route: Route, amount: TokenAmount) {
    const amounts: TokenAmount[] = new Array(
      route.path.length
    ) as TokenAmount[];
    const fees: TokenAmount[] = new Array(route.path.length) as TokenAmount[];
    const nextPairs: AnyPair[] = new Array(route.pairs.length) as AnyPair[];
    invariant(amount.token.equals(route.input), "INPUT");
    amounts[0] = amount;
    for (let i = 0; i < route.path.length - 1; i++) {
      const pair = route.pairs[i];
      const amount = amounts[i];
      invariant(pair, "PAIR");
      invariant(amount, "AMOUNT");
      const {
        amount: outputAmount,
        fees: pairFee,
        pair: nextPair,
      } = pair.getOutputAmount(amount);
      amounts[i + 1] = outputAmount;
      fees[i] = pairFee;
      nextPairs[i] = nextPair;
    }

    this.route = route;
    this.inputAmount = amount;
    const lastOutput = amounts[amounts.length - 1];
    invariant(lastOutput, "LAST_OUTPUT");
    this.outputAmount = lastOutput;
    this.executionPrice = new Price(
      this.inputAmount.token,
      this.outputAmount.token,
      this.inputAmount.raw.toString(),
      this.outputAmount.raw.toString()
    );
    this.nextMidPrice = new Route(nextPairs, route.input).midPrice;
    this.priceImpact = computePriceImpact(
      route.midPrice,
      this.inputAmount,
      this.outputAmount
    );
    this.fees = fees;
  }

  /**
   * Get the minimum amount that must be received from this trade for the given slippage tolerance
   * @param slippageTolerance tolerance of unfavorable slippage from the execution price of this trade
   */
  minimumAmountOut(slippageTolerance: Percent): TokenAmount {
    invariant(!slippageTolerance.lessThan(ZERO), "SLIPPAGE_TOLERANCE");
    const slippageAdjustedAmountOut = new Fraction(ONE)
      .add(slippageTolerance)
      .invert()
      .multiply(this.outputAmount.raw).quotient;
    return new TokenAmount(this.outputAmount.token, slippageAdjustedAmountOut);
  }

  /**
   * Given a list of pairs, and a fixed amount in, returns the top `maxNumResults` trades that go from an input token
   * amount to an output token, making at most `maxHops` hops.
   * Note this does not consider aggregation, as routes are linear. It's possible a better route exists by splitting
   * the amount in among multiple routes.
   * @param pairs the pairs to consider in finding the best trade
   * @param tokenAmountIn exact amount of the input token to spend
   * @param tokenOut the desired token out
   * @param maxNumResults maximum number of results to return
   * @param maxHops maximum number of hops a returned trade can make, e.g. 1 hop goes through a single pair
   * @param currentPairs used in recursion; the current list of pairs
   * @param originalAmountIn used in recursion; the original value of the tokenAmountIn parameter
   * @param bestTrades used in recursion; the current list of best trades
   */
  static bestTradeExactIn(
    pairs: AnyPair[],
    tokenAmountIn: TokenAmount,
    tokenOut: Token,
    { maxNumResults = 3, maxHops = 3 }: BestTradeOptions = {},
    // used in recursion.
    currentPairs: AnyPair[] = [],
    nextAmountIn: TokenAmount = tokenAmountIn,
    bestTrades: Trade[] = []
  ): Trade[] {
    invariant(pairs.length > 0, "PAIRS");
    invariant(maxHops > 0, "MAX_HOPS");
    invariant(
      tokenAmountIn === nextAmountIn || currentPairs.length > 0,
      "INVALID_RECURSION"
    );

    const amountIn = nextAmountIn;
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      // pair irrelevant
      invariant(pair, "PAIR");
      if (
        !pair.token0.equals(amountIn.token) &&
        !pair.token1.equals(amountIn.token)
      )
        continue;
      if (pair.hasZeroLiquidity()) continue;

      let amountOut: TokenAmount;
      try {
        const result = pair.getOutputAmount(amountIn);
        amountOut = result.amount;
      } catch (error) {
        // input too low
        if (
          error instanceof Error &&
          error.message === "insufficient input amount"
        ) {
          continue;
        }
        throw error;
      }
      // we have arrived at the output token, so this is the final trade of one of the paths
      if (amountOut.token.equals(tokenOut)) {
        sortedInsert(
          bestTrades,
          new Trade(
            new Route([...currentPairs, pair], tokenAmountIn.token, tokenOut),
            tokenAmountIn
          ),
          maxNumResults,
          tradeComparator
        );
      } else if (maxHops > 1 && pairs.length > 1) {
        const pairsExcludingThisPair = pairs
          .slice(0, i)
          .concat(pairs.slice(i + 1, pairs.length));

        // otherwise, consider all the other paths that lead from this token as long as we have not exceeded maxHops
        Trade.bestTradeExactIn(
          pairsExcludingThisPair,
          tokenAmountIn,
          tokenOut,
          {
            maxNumResults,
            maxHops: maxHops - 1,
          },
          [...currentPairs, pair],
          amountOut,
          bestTrades
        );
      }
    }

    return bestTrades;
  }

  /**
   * Return the execution price after accounting for slippage tolerance
   * @param slippageTolerance the allowed tolerated slippage
   */
  worstExecutionPrice(slippageTolerance: Percent): Price {
    const minOut = this.minimumAmountOut(slippageTolerance);
    return new Price(
      this.inputAmount.token,
      this.outputAmount.token,
      this.inputAmount.raw,
      minOut.raw
    );
  }
}
