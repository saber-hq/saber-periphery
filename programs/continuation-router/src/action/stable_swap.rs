//! Step implementations for StableSwap.

use std::ops::Deref;

use crate::action::ProcessAction;
use crate::*;

macro_rules! build_swap_context {
    ($component:expr, $ctx:expr $(,)?) => {{
        stable_swap_anchor::SwapUserContext {
            token_program: $ctx.token_program.clone(),
            user_authority: $ctx.owner.clone(),
            swap: $component.swap.swap.clone(),
            swap_authority: $component.swap.swap_authority.clone(),
        }
    }};
}

impl<'info> Deref for SSDepositA<'info> {
    type Target = SSDeposit<'info>;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl<'info> Deref for SSDepositB<'info> {
    type Target = SSDeposit<'info>;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl<'info> ProcessAction<'info> for SSDepositA<'info> {
    /// Runs the deposit component instruction.
    fn process(
        ctx: &ActionContext<'_, '_, '_, 'info, Self>,
        amount_in: u64,
        minimum_amount_out: u64,
    ) -> Result<()> {
        let deposit = ctx.action;
        let cpi_accounts = stable_swap_anchor::Deposit {
            user: build_swap_context!(deposit, ctx),
            input_a: (&deposit.input_a).into(),
            input_b: (&deposit.input_b).into(),
            output_lp: deposit.output_lp.to_account_info(),
            pool_mint: deposit.pool_mint.clone(),
        };
        let cpi_ctx = CpiContext::new(ctx.swap_program.clone(), cpi_accounts);
        stable_swap_anchor::deposit(cpi_ctx, amount_in, 0, minimum_amount_out)
    }

    fn input_account(&self) -> &Account<'info, TokenAccount> {
        &self.input_a.user
    }

    fn output_account(&self) -> &Account<'info, TokenAccount> {
        &self.output_lp
    }
}

impl<'info> ProcessAction<'info> for SSDepositB<'info> {
    /// Runs the deposit component instruction.
    fn process(
        ctx: &ActionContext<'_, '_, '_, 'info, Self>,
        amount_in: u64,
        minimum_amount_out: u64,
    ) -> Result<()> {
        let deposit = ctx.action;
        let cpi_accounts = stable_swap_anchor::Deposit {
            user: build_swap_context!(deposit, ctx),
            input_a: (&deposit.input_a).into(),
            input_b: (&deposit.input_b).into(),
            output_lp: deposit.output_lp.to_account_info(),
            pool_mint: deposit.pool_mint.clone(),
        };
        let cpi_ctx = CpiContext::new(ctx.swap_program.clone(), cpi_accounts);
        stable_swap_anchor::deposit(cpi_ctx, 0, amount_in, minimum_amount_out)
    }

    fn input_account(&self) -> &Account<'info, TokenAccount> {
        &self.input_b.user
    }

    fn output_account(&self) -> &Account<'info, TokenAccount> {
        &self.output_lp
    }
}

impl<'info> ProcessAction<'info> for SSWithdrawOne<'info> {
    /// Runs the deposit component instruction.
    fn process(
        ctx: &ActionContext<'_, '_, '_, 'info, Self>,
        amount_in: u64,
        minimum_amount_out: u64,
    ) -> Result<()> {
        let action = ctx.action;
        let cpi_accounts = stable_swap_anchor::WithdrawOne {
            user: build_swap_context!(action, ctx),
            pool_mint: action.pool_mint.clone(),
            input_lp: action.input_lp.to_account_info(),
            quote_reserves: action.quote_reserves.clone(),
            output: (&action.output).into(),
        };
        let cpi_ctx = CpiContext::new(ctx.swap_program.clone(), cpi_accounts);
        stable_swap_anchor::withdraw_one(cpi_ctx, amount_in, minimum_amount_out)
    }

    fn input_account(&self) -> &Account<'info, TokenAccount> {
        &self.input_lp
    }

    fn output_account(&self) -> &Account<'info, TokenAccount> {
        &self.output.user_token.user
    }
}

impl<'info> ProcessAction<'info> for SSSwap<'info> {
    /// Runs the deposit component instruction.
    fn process(
        ctx: &ActionContext<'_, '_, '_, 'info, Self>,
        amount_in: u64,
        minimum_amount_out: u64,
    ) -> Result<()> {
        let action = ctx.action;
        let cpi_accounts = stable_swap_anchor::Swap {
            user: build_swap_context!(action, ctx),
            input: (&action.input).into(),
            output: (&action.output).into(),
        };
        let cpi_ctx = CpiContext::new(ctx.swap_program.clone(), cpi_accounts);
        stable_swap_anchor::swap(cpi_ctx, amount_in, minimum_amount_out)
    }

    fn input_account(&self) -> &Account<'info, TokenAccount> {
        &self.input.user
    }

    fn output_account(&self) -> &Account<'info, TokenAccount> {
        &self.output.user_token.user
    }
}

impl<'info> From<&SwapToken<'info>> for stable_swap_anchor::SwapToken<'info> {
    fn from(accounts: &SwapToken<'info>) -> stable_swap_anchor::SwapToken<'info> {
        stable_swap_anchor::SwapToken {
            user: accounts.user.to_account_info(),
            reserve: accounts.reserve.clone(),
        }
    }
}

impl<'info> From<&SwapOutput<'info>> for stable_swap_anchor::SwapOutput<'info> {
    fn from(accounts: &SwapOutput<'info>) -> stable_swap_anchor::SwapOutput<'info> {
        stable_swap_anchor::SwapOutput {
            user_token: (&accounts.user_token).into(),
            fees: accounts.fees.clone(),
        }
    }
}
