import type { Provider } from "@saberhq/solana-contrib";
import { TransactionEnvelope } from "@saberhq/solana-contrib";
import type { Token, TokenAmount } from "@saberhq/token-utils";
import {
  createInitMintInstructions,
  getATAAddress,
  getOrCreateATAs,
  SPLToken,
  TOKEN_PROGRAM_ID,
  TokenAccountLayout,
} from "@saberhq/token-utils";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import invariant from "tiny-invariant";

import type {
  AddDecimalsProgram,
  UserStakeAccounts,
  WrappedTokenData,
} from "../../programs/addDecimals";
import { LazyWrappedToken, WrappedToken } from "../entities/wrappedToken";

/**
 * Program-related actions on a wrapped token.
 */
export class WrappedTokenActions {
  constructor(
    readonly provider: Provider,
    readonly program: AddDecimalsProgram,
    private _wrapped: LazyWrappedToken
  ) {}

  get wrapped(): LazyWrappedToken {
    return this._wrapped;
  }

  /**
   * Creates the wrapped token if it doesn't exist.
   * @param mintKP Keypair of the mint account.
   * @returns
   */
  async createIfNotExists(
    mintKP: Keypair = Keypair.generate()
  ): Promise<TransactionEnvelope | null> {
    const info = await this.program.provider.connection.getAccountInfo(
      this.wrapped.wrapper
    );
    if (info) {
      return null;
    }
    const [nextKey, nonce] = await WrappedToken.getAddressAndNonce(
      this.program.programId,
      this.wrapped.underlying.mintAccount,
      this.wrapped.decimals
    );
    invariant(nextKey.equals(this.wrapped.wrapper), "key mismatch");

    const underlyingTokensKP = Keypair.generate();

    const init = this.program.instruction.initializeWrapper(nonce, {
      accounts: {
        wrapper: nextKey,
        wrapperUnderlyingTokens: underlyingTokensKP.publicKey,
        underlyingMint: this.wrapped.underlying.mintAccount,
        wrapperMint: mintKP.publicKey,
        payer: this.program.provider.wallet.publicKey,
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: SystemProgram.programId,
      },
    });

    // create mint
    const initMint = await createInitMintInstructions({
      provider: this.provider,
      mintKP,
      decimals: this.wrapped.decimals,
      mintAuthority: this.wrapped.wrapper,
      freezeAuthority: this.wrapped.wrapper,
    });

    // create underlying tokens account
    const initAccount = new TransactionEnvelope(
      this.provider,
      [
        SystemProgram.createAccount({
          fromPubkey: this.program.provider.wallet.publicKey,
          newAccountPubkey: underlyingTokensKP.publicKey,
          space: TokenAccountLayout.span,
          lamports: await SPLToken.getMinBalanceRentForExemptAccount(
            this.program.provider.connection
          ),
          programId: TOKEN_PROGRAM_ID,
        }),
        SPLToken.createInitAccountInstruction(
          TOKEN_PROGRAM_ID,
          this.wrapped.underlying.mintAccount,
          underlyingTokensKP.publicKey,
          this.wrapped.wrapper
        ),
        // create wrapper
        init,
      ],
      [underlyingTokensKP]
    );

    return initMint.combine(initAccount);
  }

  /**
   * Loads the actions with the wrapper.
   * @param program
   * @param underlying
   * @param decimals
   * @returns
   */
  static async loadWithActions(
    provider: Provider,
    program: AddDecimalsProgram,
    underlying: Token,
    decimals: number
  ): Promise<WrappedTokenActions> {
    const wta = await LazyWrappedToken.load(program, underlying, decimals);
    return new WrappedTokenActions(provider, program, wta);
  }

  async loadData(): Promise<WrappedTokenData> {
    const nextData = await this.program.account.wrappedToken.fetch(
      this.wrapped.wrapper
    );
    return nextData;
  }

  /**
   * Reloads the wrapped token, returning one with the new data.
   */
  async reload(): Promise<WrappedToken> {
    const nextData = await this.loadData();
    return (this._wrapped = new WrappedToken(
      this.wrapped.underlying,
      this.wrapped.wrapper,
      nextData.wrapperMint,
      this.wrapped.decimals
    ));
  }

  async wrap(amount: TokenAmount): Promise<TransactionEnvelope> {
    invariant(
      amount.token.equals(this.wrapped.underlying),
      "must be underlying"
    );
    const { accounts, instructions } = await this.genUserStake();
    return new TransactionEnvelope(this.provider, [
      ...instructions,
      this.program.instruction.deposit(amount.toU64(), {
        accounts,
      }),
    ]);
  }

  async unwrap(amount: TokenAmount): Promise<TransactionEnvelope> {
    invariant(this.wrapped.token, "token not initialized");
    invariant(amount.token.equals(this.wrapped.token), "must be token");
    const { accounts, instructions } = await this.genUserStake();
    return new TransactionEnvelope(this.provider, [
      ...instructions,
      this.program.instruction.withdraw(amount.toU64(), {
        accounts,
      }),
    ]);
  }

  async unwrapAllIX(): Promise<TransactionInstruction> {
    invariant(this.wrapped.token, "token not initialized");
    const { accounts } = await this.genUserStake();
    return this.program.instruction.withdrawAll({
      accounts,
    });
  }

  async unwrapAll(): Promise<TransactionEnvelope> {
    invariant(this.wrapped.token, "token not initialized");
    const { accounts, instructions } = await this.genUserStake();
    return new TransactionEnvelope(this.provider, [
      ...instructions,
      this.program.instruction.withdrawAll({
        accounts,
      }),
    ]);
  }

  async getAssociatedTokenAddress(): Promise<PublicKey> {
    invariant(this.wrapped.mintAccount, "token not initialized");
    return getATAAddress({
      mint: this.wrapped.mintAccount,
      owner: this.program.provider.wallet.publicKey,
    });
  }

  async genUserStake(): Promise<{
    accounts: { [K in keyof UserStakeAccounts]: PublicKey };
    instructions: readonly TransactionInstruction[];
    createAccountInstructions: {
      underlying: TransactionInstruction | null;
      wrapped: TransactionInstruction | null;
    };
  }> {
    const mint = this.wrapped.mintAccount;
    invariant(mint, "token not initialized");
    const { accounts, instructions, createAccountInstructions } =
      await getOrCreateATAs({
        provider: this.provider,
        mints: {
          underlying: this.wrapped.underlying.mintAccount,
          wrapped: mint,
        },
        owner: this.program.provider.wallet.publicKey,
      });

    return {
      instructions,
      accounts: {
        wrapper: this.wrapped.wrapper,
        wrapperMint: mint,
        wrapperUnderlyingTokens: (await this.loadData())
          .wrapperUnderlyingTokens,
        owner: this.program.provider.wallet.publicKey,
        userUnderlyingTokens: accounts.underlying,
        userWrappedTokens: accounts.wrapped,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
      createAccountInstructions,
    };
  }
}
