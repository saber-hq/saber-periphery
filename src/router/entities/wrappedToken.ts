import { utils } from "@project-serum/anchor";
import type { Network } from "@saberhq/solana-contrib";
import { Token, TokenAmount } from "@saberhq/token-utils";
import { PublicKey } from "@solana/web3.js";
import JSBI from "jsbi";
import invariant from "tiny-invariant";

import type { AddDecimalsProgram } from "../../programs";

/**
 * Wrapped token with altered decimals.
 *
 * To reload this token after initializing it, construct a "WrappedTokenActions"
 * and call `reload`.
 */
export class LazyWrappedToken<K extends PublicKey | null = PublicKey | null> {
  constructor(
    readonly underlying: Token,
    readonly wrapper: PublicKey,
    readonly mintAccount: K,
    readonly decimals: number
  ) {}

  get name(): string {
    const decimalsSuffix =
      this.decimals === this.underlying.decimals
        ? ``
        : ` (${this.decimals} decimals)`;
    return `Saber Wrapped ${this.underlying.name}${decimalsSuffix}`;
  }

  get symbol(): string {
    const decimalsSuffix =
      this.decimals === this.underlying.decimals ? `` : `-${this.decimals}`;
    return `s${this.underlying.symbol}${decimalsSuffix}`;
  }

  get chainId(): number {
    return this.underlying.chainId;
  }

  get network(): Network {
    return this.underlying.network;
  }

  get icon(): string | undefined {
    return this.underlying.icon;
  }

  get address(): K extends null ? null : string {
    type Ret = K extends null ? null : string;
    return (this.mintAccount?.toString() ?? null) as Ret;
  }

  get multiplier(): number {
    return 10 ** (this.decimals - this.underlying.decimals);
  }

  equals(other: LazyWrappedToken): boolean {
    if (other instanceof WrappedToken) {
      return other.wrapper.equals(this.wrapper);
    }
    if (this.address) {
      return this.address === other.address;
    }
    return false;
  }

  get token(): K extends null ? null : Token {
    type Ret = K extends null ? null : Token;
    const address = this.address;
    if (!address) {
      return null as Ret;
    }
    return new Token({
      name: this.name,
      address,
      decimals: this.decimals,
      symbol: this.symbol,
      chainId: this.chainId,
    }) as Ret;
  }

  /**
   * Loads a wrapped token.
   */
  static async load(
    program: AddDecimalsProgram,
    underlying: Token,
    decimals: number
  ): Promise<LazyWrappedToken> {
    const [wrapperAddress] = await WrappedToken.getAddressAndNonce(
      program.programId,
      underlying.mintAccount,
      decimals
    );
    try {
      const data = await program.account.wrappedToken.fetch(wrapperAddress);
      return new WrappedToken(
        underlying,
        wrapperAddress,
        data.wrapperMint,
        decimals
      );
    } catch (e) {
      if (e instanceof Error && e.message.includes("Account does not exist")) {
        return new LazyWrappedToken(underlying, wrapperAddress, null, decimals);
      }
      throw e;
    }
  }

  /**
   * Gets the address and nonce of a wrapped token.
   * @param programID
   * @param underlyingMint
   * @param decimals
   * @returns
   */
  static async getAddressAndNonce(
    programID: PublicKey,
    underlyingMint: PublicKey,
    decimals: number
  ): Promise<[PublicKey, number]> {
    return await PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode("anchor")), // b"anchor".
        underlyingMint.toBytes(),
        Buffer.from([decimals]),
      ],
      programID
    );
  }
}

/**
 * Wrapped token that is already initialized.
 */
export class WrappedToken extends LazyWrappedToken<PublicKey> {
  calculateDepositOutputAmount(inputAmount: TokenAmount): TokenAmount {
    invariant(
      inputAmount.token.equals(this.underlying),
      "input deposit mismatch"
    );
    return new TokenAmount(
      this.token,
      JSBI.multiply(inputAmount.raw, JSBI.BigInt(this.multiplier))
    );
  }

  calculateWithdrawOutputAmount(inputAmount: TokenAmount): TokenAmount {
    invariant(
      inputAmount.token.equals(this.token),
      "input withdrawal mismatch"
    );
    return new TokenAmount(
      this.underlying,
      JSBI.divide(inputAmount.raw, JSBI.BigInt(this.multiplier))
    );
  }

  calculateOutputAmount(inputAmount: TokenAmount): TokenAmount {
    let outputAmount: TokenAmount | null = null;
    if (this.token.equals(inputAmount.token)) {
      // withdraw, so divide
      outputAmount = this.calculateWithdrawOutputAmount(inputAmount);
    } else if (inputAmount.token.equals(this.underlying)) {
      // deposit, so multiply
      outputAmount = this.calculateDepositOutputAmount(inputAmount);
    }
    invariant(
      outputAmount,
      `unknown input token: ${inputAmount.token.mintAccount.toString()}`
    );
    return outputAmount;
  }
}
