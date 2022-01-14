import type { Provider } from "@saberhq/solana-contrib";
import { TransactionEnvelope } from "@saberhq/solana-contrib";
import type { StableSwap } from "@saberhq/stableswap-sdk";
import { SWAP_PROGRAM_ID } from "@saberhq/stableswap-sdk";
import type { Token, TokenAmount } from "@saberhq/token-utils";
import {
  getOrCreateATA,
  getOrCreateATAs,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@saberhq/token-utils";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  Keypair,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import invariant from "tiny-invariant";

import type {
  AddDecimalsProgram,
  ContinuationRouterProgram,
} from "../../programs";
import type { Router } from "../router";
import { WrappedTokenActions } from "./wrappedTokenActions";

interface SSAction {
  swap: StableSwap;
  action: "ssSwap" | "ssWithdrawOne" | "ssDepositA" | "ssDepositB";
}

interface ADAction {
  action: "adWithdraw" | "adDeposit";
  underlying: Token;
  decimals: number;
}

export type Action = {
  outputToken: Token;
} & (SSAction | ADAction);

export class ActionPlan {
  readonly program: ContinuationRouterProgram;

  constructor(
    readonly router: Router,
    readonly inputAmount: TokenAmount,
    readonly minimumAmountOut: TokenAmount,
    readonly actions: Action[] = []
  ) {
    this.program = router.programs.ContinuationRouter;
  }

  addAction(...actions: Action[]): ActionPlan {
    this.actions.push(...actions);
    return this;
  }

  async buildTX(): Promise<TransactionEnvelope> {
    const { provider } = this.router;
    const user = provider.wallet.publicKey;

    const continuationKP = Keypair.generate();

    const initInstructions: TransactionInstruction[] = [];
    const initedAccounts = new Set<string>();
    const { accounts } = await getOrCreateATAs({
      provider: this.router.provider,
      mints: {
        input: this.inputAmount.token.mintAccount,
        output: this.minimumAmountOut.token.mintAccount,
      },
    });

    // the input account should already exist
    initedAccounts.add(accounts.input.toString());

    const continuationAddr = continuationKP.publicKey;
    const createIX = await this.program.account.continuation.createInstruction(
      continuationKP
    );
    const begin = this.program.instruction.beginV2(
      this.inputAmount.toU64(),
      this.minimumAmountOut.toU64(),
      this.actions.length,
      {
        accounts: {
          continuation: continuationKP.publicKey,
          input: accounts.input,
          output: accounts.output,
          owner: user,
        },
      }
    );

    const swapInstructions: TransactionInstruction[] = [];
    for (const action of this.actions) {
      if ("swap" in action) {
        const { instruction, createOutputATA, output } =
          await makeSSInstruction(
            provider,
            this.program,
            continuationAddr,
            action
          );
        if (createOutputATA && !initedAccounts.has(output.toString())) {
          initInstructions.push(createOutputATA);
          initedAccounts.add(output.toString());
        }
        swapInstructions.push(instruction);
      } else if ("underlying" in action) {
        const { instruction, createOutputATA, output } =
          await makeADInstruction(
            provider,
            this.router.programs.AddDecimals,
            this.program,
            continuationAddr,
            action
          );
        if (createOutputATA && !initedAccounts.has(output.toString())) {
          initInstructions.push(createOutputATA);
          initedAccounts.add(output.toString());
        }
        swapInstructions.push(instruction);
      } else {
        throw new Error("unimplemented");
      }
    }

    const end = this.program.instruction.end({
      accounts: {
        continuation: continuationAddr,
        output: accounts.output,
        owner: user,
        payer: user,
      },
    });

    return this.router.provider.newTX(
      [...initInstructions, createIX, begin, ...swapInstructions, end],
      [continuationKP]
    );
  }

  async buildTXWithEphemeralInput(
    ephemeralInput: PublicKey
  ): Promise<TransactionEnvelope> {
    const { provider } = this.router;
    const user = provider.wallet.publicKey;

    const random = Keypair.generate();
    const continuationAddr =
      await this.program.account.continuation.associatedAddress(
        user,
        random.publicKey
      );

    const initInstructions: TransactionInstruction[] = [];
    const initedAccounts = new Set<string>();
    const { accounts } = await getOrCreateATAs({
      provider: this.router.provider,
      mints: {
        output: this.minimumAmountOut.token.mintAccount,
      },
    });

    // the input account should already exist
    initedAccounts.add(ephemeralInput.toString());

    const begin = this.program.instruction.begin(
      this.inputAmount.toU64(),
      this.minimumAmountOut.toU64(),
      this.actions.length,
      {
        accounts: {
          continuation: continuationAddr,
          random: random.publicKey,
          input: ephemeralInput,
          output: accounts.output,
          owner: user,
          payer: user,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: SystemProgram.programId,
        },
      }
    );

    const swapInstructions: TransactionInstruction[] = [];
    for (const action of this.actions) {
      if ("swap" in action) {
        const { instruction, createOutputATA, output } =
          await makeSSInstructionWithEmpheralInput(
            provider,
            this.program,
            continuationAddr,
            ephemeralInput,
            action
          );
        if (createOutputATA && !initedAccounts.has(output.toString())) {
          initInstructions.push(createOutputATA);
          initedAccounts.add(output.toString());
        }
        swapInstructions.push(instruction);
      } else {
        throw new Error("unimplemented");
      }
    }

    const end = this.program.instruction.end({
      accounts: {
        continuation: continuationAddr,
        output: accounts.output,
        owner: user,
        payer: user,
      },
    });

    return new TransactionEnvelope(this.router.provider, [
      ...initInstructions,
      begin,
      ...swapInstructions,
      end,
    ]);
  }

  async manualSSWithdrawOne(): Promise<TransactionEnvelope> {
    invariant(this.actions.length >= 1, "Must have at least one action");
    invariant(
      this.actions[0]?.action === "ssWithdrawOne",
      "Frist action must be ssWithdrawOne"
    );
    const withdrawOneAction = this.actions[0];

    const { provider } = this.router;
    const { accounts, instructions } = await getOrCreateATAs({
      provider,
      mints: {
        source: this.inputAmount.token.mintAccount, // LP token account
        destination: this.minimumAmountOut.token.mintAccount,
      },
    });

    const allInstructions: TransactionInstruction[] = [];
    if (instructions.length) {
      allInstructions.push(...instructions);
    }

    const { swap } = withdrawOneAction;
    allInstructions.push(
      swap.withdrawOne({
        userAuthority: provider.wallet.publicKey,
        baseTokenAccount: this.minimumAmountOut.token.mintAccount.equals(
          swap.state.tokenA.mint
        )
          ? swap.state.tokenA.reserve
          : swap.state.tokenB.reserve,
        destinationAccount: accounts.destination,
        sourceAccount: accounts.source,
        poolTokenAmount: this.inputAmount.toU64(),
        minimumTokenAmount: this.minimumAmountOut.toU64(),
      })
    );

    if (this.actions[1]) {
      invariant(
        this.actions[1]?.action === "adWithdraw",
        "Second action must be adWithdraw"
      );
      const adWithdrawAction = this.actions[1];
      const { instruction } = await getOrCreateATA({
        provider,
        mint: adWithdrawAction.underlying.mintAccount,
      });

      if (instruction) {
        allInstructions.push(instruction);
      }

      const wrapped = await WrappedTokenActions.loadWithActions(
        provider,
        this.router.programs.AddDecimals,
        adWithdrawAction.underlying,
        adWithdrawAction.decimals
      );
      allInstructions.push(await wrapped.unwrapAllIX());
    }

    return new TransactionEnvelope(provider, allInstructions);
  }
}

const makeSSInstruction = async (
  provider: Provider,
  program: ContinuationRouterProgram,
  continuation: PublicKey,
  action: Action & SSAction
): Promise<{
  accounts: PublicKey[];
  mints: PublicKey[];
  output: PublicKey;
  createOutputATA: TransactionInstruction | null;
  instruction: TransactionInstruction;
}> => {
  const [inputToken, outputToken] = action.outputToken.mintAccount.equals(
    action.swap.state.tokenA.mint
  )
    ? (["tokenB", "tokenA"] as const)
    : (["tokenA", "tokenB"] as const);
  const user = provider.wallet.publicKey;

  const cContext = {
    continuation,
    tokenProgram: TOKEN_PROGRAM_ID,
    swapProgram: SWAP_PROGRAM_ID,
    owner: user,
  };

  const { swap } = action;
  const swapCtx = {
    swap: swap.config.swapAccount,
    swapAuthority: swap.config.authority,
    clock: SYSVAR_CLOCK_PUBKEY,
  };

  switch (action.action) {
    case "ssSwap": {
      const {
        accounts: { input, output },
        createAccountInstructions,
      } = await getOrCreateATAs({
        provider,
        mints: {
          // swap
          input: swap.state[inputToken].mint,
          output: swap.state[outputToken].mint,
        },
        owner: user,
      });
      const instruction = program.instruction.ssSwap({
        accounts: {
          continuation: cContext,
          action: {
            swap: swapCtx,
            input: {
              user: input,
              reserve:
                swap.state[outputToken === "tokenA" ? "tokenB" : "tokenA"]
                  .reserve,
            },
            output: {
              userToken: {
                user: output,
                reserve: swap.state[outputToken].reserve,
              },
              fees: swap.state[outputToken].adminFeeAccount,
            },
          },
        },
      });
      return {
        accounts: [input, output],
        output,
        mints: [swap.state[inputToken].mint, swap.state[outputToken].mint],
        createOutputATA: createAccountInstructions.output ?? null,
        instruction,
      };
    }

    case "ssWithdrawOne": {
      const {
        accounts: { inputLP, output },
        createAccountInstructions,
      } = await getOrCreateATAs({
        provider,
        mints: {
          // swap
          inputLP: swap.state.poolTokenMint,
          output: swap.state[outputToken].mint,
        },
        owner: user,
      });
      const instruction = program.instruction.ssWithdrawOne({
        accounts: {
          continuation: cContext,
          action: {
            swap: swapCtx,
            poolMint: swap.state.poolTokenMint,
            inputLp: inputLP,
            quoteReserves: swap.state[inputToken].reserve,
            output: {
              userToken: {
                user: output,
                reserve: swap.state[outputToken].reserve,
              },
              fees: swap.state[outputToken].adminFeeAccount,
            },
          },
        },
      });
      return {
        accounts: [inputLP, output],
        output,
        mints: [swap.state.poolTokenMint, swap.state[outputToken].mint],
        createOutputATA: createAccountInstructions.output ?? null,
        instruction,
      };
    }
  }

  throw new Error("unimplemented");
};

const makeSSInstructionWithEmpheralInput = async (
  provider: Provider,
  program: ContinuationRouterProgram,
  continuation: PublicKey,
  ephemeralInput: PublicKey,
  action: Action & SSAction
): Promise<{
  accounts: PublicKey[];
  mints: PublicKey[];
  output: PublicKey;
  createOutputATA: TransactionInstruction | null;
  instruction: TransactionInstruction;
}> => {
  const [inputToken, outputToken] = action.outputToken.mintAccount.equals(
    action.swap.state.tokenA.mint
  )
    ? (["tokenB", "tokenA"] as const)
    : (["tokenA", "tokenB"] as const);
  const user = provider.wallet.publicKey;

  const cContext = {
    continuation,
    tokenProgram: TOKEN_PROGRAM_ID,
    swapProgram: SWAP_PROGRAM_ID,
    owner: user,
  };

  const { swap } = action;
  const swapCtx = {
    swap: swap.config.swapAccount,
    swapAuthority: swap.config.authority,
    clock: SYSVAR_CLOCK_PUBKEY,
  };

  switch (action.action) {
    case "ssSwap": {
      const {
        accounts: { input, output },
        createAccountInstructions,
      } = await getOrCreateATAs({
        provider,
        mints: {
          // swap
          input: swap.state[inputToken].mint,
          output: swap.state[outputToken].mint,
        },
        owner: user,
      });

      // Use ephemeral input account if input mint is NATIVE_MINT
      const userInput = swap.state[inputToken].mint.equals(NATIVE_MINT)
        ? ephemeralInput
        : input;

      const instruction = program.instruction.ssSwap({
        accounts: {
          continuation: cContext,
          action: {
            swap: swapCtx,
            input: {
              user: userInput,
              reserve:
                swap.state[outputToken === "tokenA" ? "tokenB" : "tokenA"]
                  .reserve,
            },
            output: {
              userToken: {
                user: output,
                reserve: swap.state[outputToken].reserve,
              },
              fees: swap.state[outputToken].adminFeeAccount,
            },
          },
        },
      });
      return {
        accounts: [userInput, output],
        output,
        mints: [swap.state[inputToken].mint, swap.state[outputToken].mint],
        createOutputATA: createAccountInstructions.output ?? null,
        instruction,
      };
    }

    case "ssWithdrawOne": {
      const {
        accounts: { inputLP, output },
        createAccountInstructions,
      } = await getOrCreateATAs({
        provider,
        mints: {
          // swap
          inputLP: swap.state.poolTokenMint,
          output: swap.state[outputToken].mint,
        },
        owner: user,
      });
      const instruction = program.instruction.ssWithdrawOne({
        accounts: {
          continuation: cContext,
          action: {
            swap: swapCtx,
            poolMint: swap.state.poolTokenMint,
            inputLp: inputLP,
            quoteReserves: swap.state[inputToken].reserve,
            output: {
              userToken: {
                user: output,
                reserve: swap.state[outputToken].reserve,
              },
              fees: swap.state[outputToken].adminFeeAccount,
            },
          },
        },
      });
      return {
        accounts: [inputLP, output],
        output,
        mints: [swap.state.poolTokenMint, swap.state[outputToken].mint],
        createOutputATA: createAccountInstructions.output ?? null,
        instruction,
      };
    }
  }

  throw new Error("unimplemented");
};

const makeADInstruction = async (
  provider: Provider,
  addDecimals: AddDecimalsProgram,
  program: ContinuationRouterProgram,
  continuation: PublicKey,
  action: Action & ADAction
): Promise<{
  output: PublicKey;
  createOutputATA: TransactionInstruction | null;
  instruction: TransactionInstruction;
}> => {
  const user = provider.wallet.publicKey;

  const wrapped = await WrappedTokenActions.loadWithActions(
    provider,
    addDecimals,
    action.underlying,
    action.decimals
  );
  const token = wrapped.wrapped.token;
  invariant(token, "Invalid wrapped token");
  if (action.action === "adDeposit") {
    invariant(
      token.equals(action.outputToken),
      "deposit: output must be wrapped token"
    );
  } else if (action.action === "adWithdraw") {
    invariant(
      action.underlying.equals(action.outputToken),
      "withdraw: output must be underlying"
    );
  }

  const cContext = {
    continuation,
    tokenProgram: TOKEN_PROGRAM_ID,
    swapProgram: addDecimals.programId,
    owner: user,
  };

  const { createAccountInstructions, accounts } = await wrapped.genUserStake();
  const accountsOrdered = addDecimals.instruction.withdraw.accounts(accounts);

  let actionAccounts = null;
  let createOutputATA = null;
  if (action.action === "adWithdraw") {
    createOutputATA = createAccountInstructions.underlying;
    actionAccounts = {
      input: accounts.userWrappedTokens,
      output: accounts.userUnderlyingTokens,
    };
  } else if (action.action === "adDeposit") {
    createOutputATA = createAccountInstructions.wrapped;
    actionAccounts = {
      input: accounts.userUnderlyingTokens,
      output: accounts.userWrappedTokens,
    };
  }
  invariant(actionAccounts, "action accounts");

  const instruction = program.instruction[action.action]({
    accounts: {
      continuation: cContext,
      action: actionAccounts,
    },
    remainingAccounts: accountsOrdered,
  });

  return {
    output: actionAccounts.output,
    createOutputATA,
    instruction,
  };
};
