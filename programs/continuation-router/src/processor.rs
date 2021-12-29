use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use vipers::{assert_keys_eq, invariant};

use crate::{Action, Continuation, SwapActionEvent, TokenAmount};

pub trait ActionInputOutput<'info>: Action {
    fn input_account(&self) -> &Account<'info, TokenAccount>;
    fn output_account(&self) -> &Account<'info, TokenAccount>;
}

pub struct ActionContext<'a, 'b, 'c, 'info, T> {
    /// Currently executing program id.
    pub program_id: &'a Pubkey,
    /// Deserialized accounts.
    pub action: &'b T,
    /// Remaining accounts given but not deserialized or validated.
    /// Be very careful when using this directly.
    pub remaining_accounts: &'c [AccountInfo<'info>],
    /// The spl_token program.
    pub token_program: AccountInfo<'info>,
    /// The relevant swap program.
    pub swap_program: AccountInfo<'info>,
    /// The owner of all involved token accounts.
    pub owner: AccountInfo<'info>,
}

/// Processes a context.
pub trait Processor<'info>: ActionInputOutput<'info> {
    fn process_unchecked(&self, amount_in: u64, minimum_amount_out: u64) -> ProgramResult;

    fn process(&self, continuation: &mut Account<'info, Continuation>) -> ProgramResult {
        msg!("Router action: {:?}", Self::TYPE);
        let continuation = continuation;
        invariant!(continuation.steps_left > 0, NoMoreSteps);

        let input_account = self.input_account();
        assert_keys_eq!(input_account, continuation.input, PathInputOutputMismatch);
        assert_keys_eq!(input_account.owner, continuation.owner, InputOwnerMismatch);
        assert_keys_eq!(
            input_account.mint,
            continuation.amount_in.mint,
            InputMintMismatch
        );

        // ensure swap is non-zero
        let amount_in = continuation.amount_in;
        invariant!(amount_in.amount != 0, ZeroSwap);

        // ensure amount in is at least the desired amount
        invariant!(
            input_account.amount >= amount_in.amount,
            InsufficientInputBalance
        );

        // ensure output account is owned by the owner
        let output_account = self.output_account();
        assert_keys_eq!(
            output_account.owner,
            continuation.owner,
            OutputOwnerMismatch
        );

        // process step
        let initial_balance = output_account.amount;
        let minimum_amount_out = if continuation.steps_left == 1 {
            assert_keys_eq!(
                continuation.minimum_amount_out.mint,
                output_account.mint,
                OutputMintMismatch
            );
            continuation.minimum_amount_out.amount
        } else {
            0
        };
        self.process_unchecked(amount_in.amount, minimum_amount_out)?;
        let output_account = &mut output_account.clone();
        output_account.reload()?;
        let result_balance = output_account.amount;

        // ensure that the new balance is higher than the old balance
        invariant!(result_balance >= initial_balance, BalanceLower);
        let next_amount_in = result_balance - initial_balance;

        // write results
        continuation.input = output_account.key();
        continuation.amount_in = TokenAmount::new(output_account.mint, next_amount_in);
        continuation.steps_left -= 1;

        emit!(SwapActionEvent {
            action_type: Self::TYPE,
            owner: continuation.owner,
            input_amount: amount_in,
            output_account: continuation.input,
            output_amount: continuation.amount_in,
        });
        Ok(())
    }
}
