import type { Network } from "@saberhq/solana-contrib";
import type { Price, Token } from "@saberhq/token-utils";
import invariant from "tiny-invariant";

import type { AnyPair } from "./pair";

export class Route {
  readonly path: Token[];
  readonly output: Token;
  readonly midPrice: Price;

  constructor(
    readonly pairs: AnyPair[],
    readonly input: Token,
    output?: Token
  ) {
    invariant(pairs.length > 0, "PAIRS");
    const firstPair = pairs[0];
    invariant(firstPair, "PAIRS");
    invariant(
      pairs.every((pair) => pair.network === firstPair.network),
      "CHAIN_IDS"
    );
    invariant(firstPair.involvesToken(input), "INPUT");
    invariant(
      typeof output === "undefined" ||
        pairs[pairs.length - 1]?.involvesToken(output),
      "OUTPUT"
    );

    const path: Token[] = [input];
    for (const [i, pair] of pairs.entries()) {
      const currentInput = path[i];
      invariant(
        currentInput &&
          (currentInput.equals(pair.token0) ||
            currentInput.equals(pair.token1)),
        "PATH"
      );
      const output = currentInput.equals(pair.token0)
        ? pair.token1
        : pair.token0;
      path.push(output);
    }

    this.path = path;
    this.midPrice = this.asPrice();
    const theOutput = output ?? path[path.length - 1];
    invariant(theOutput, "OUTPUT");
    this.output = theOutput;
  }

  asPrice(): Price {
    const prices: Price[] = [];
    for (const [i, pair] of this.pairs.entries()) {
      const element = this.path[i];
      invariant(element, "path element");
      prices.push(
        element.equals(pair.token0) ? pair.token1Price : pair.token0Price
      );
    }
    if (!prices[0]) {
      throw new Error("no prices");
    }
    return prices.reduce((accumulator, currentValue) =>
      accumulator.multiply(currentValue)
    );
  }

  get network(): Network {
    return this.input.network;
  }
}
