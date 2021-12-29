import { Price, TokenAmount } from "@saberhq/token-utils";

import type { WrappedToken } from "../wrappedToken";
import type { PoolStrategy } from ".";
import { Pair } from ".";

const poolStrategy: PoolStrategy<WrappedToken> = {
  getOutputAmount: (wrapped, inputAmount) => {
    return {
      amount: wrapped.calculateOutputAmount(inputAmount),
      fees: new TokenAmount(inputAmount.token, 0),
      pair: pairFromWrappedToken(wrapped),
    };
  },
  getPriceOfToken1: (wrapped) => {
    return new Price(wrapped.underlying, wrapped.token, 1, wrapped.multiplier);
  },
  hasZeroLiquidity: (_exchange) => {
    return false;
  },

  getToken0: (pool) => pool.underlying,
  getToken1: (pool) => pool.token,

  asAction: (pool, outputToken) => ({
    action: pool.underlying.equals(outputToken) ? "adWithdraw" : "adDeposit",
    underlying: pool.underlying,
    decimals: pool.decimals,
    outputToken,
  }),
};

export const pairFromWrappedToken = (
  wrapped: WrappedToken
): Pair<WrappedToken> => {
  return new Pair(wrapped, poolStrategy);
};
