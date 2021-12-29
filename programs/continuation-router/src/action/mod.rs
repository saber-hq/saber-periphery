use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::processor::ActionContext;

pub mod stable_swap;

pub trait ProcessAction<'info>: Sized {
    /// Processes the action.
    fn process(
        ctx: &ActionContext<'_, '_, '_, 'info, Self>,
        amount_in: u64,
        minimum_amount_out: u64,
    ) -> ProgramResult;

    fn input_account(&self) -> &Account<'info, TokenAccount>;

    fn output_account(&self) -> &Account<'info, TokenAccount>;
}
