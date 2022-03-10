//! Atomically routes a swap between multiple pools.
//!
//! To use this, create a transaction consisting of the following instructions:
//! 1. A [Begin] instruction
//! 2. Action instructions
//! 3. An [End] instruction

use continuation_router_syn::router_action;

use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use num_enum::{IntoPrimitive, TryFromPrimitive};

pub mod action;
pub mod processor;

use crate::action::ProcessAction;
use crate::processor::{ActionContext, Processor};

declare_id!("Crt7UoUR6QgrFrN7j8rmSQpUTNWNSitSwWvsWGf1qZ5t");

macro_rules! process_action {
    ($ctx:expr) => {{
        let ctx = $ctx;
        let cont = &mut ctx.accounts.continuation.continuation;
        let action = &ctx.accounts.action;
        let action_ctx = &ActionContext {
            program_id: ctx.program_id,
            action,
            remaining_accounts: ctx.remaining_accounts,
            token_program: ctx.accounts.continuation.token_program.to_account_info(),
            swap_program: ctx.accounts.continuation.swap_program.to_account_info(),
            owner: ctx.accounts.continuation.owner.to_account_info(),
        };
        Processor::process(action_ctx, cont)
    }};
}

#[program]
pub mod continuation_router {
    use super::*;

    /// Creates an ATA if it does not yet exist.
    pub fn create_ata_if_not_exists(ctx: Context<CreateATAIfNotExists>) -> Result<()> {
        if !ctx.accounts.ata.try_borrow_data()?.is_empty() {
            // ata already exists.
            return Ok(());
        }
        anchor_spl::associated_token::create(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            anchor_spl::associated_token::Create {
                payer: ctx.accounts.payer.to_account_info(),
                associated_token: ctx.accounts.ata.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ))?;
        Ok(())
    }

    /// Begins a swap transaction.
    pub fn begin(
        ctx: Context<Begin>,
        amount_in: u64,
        minimum_amount_out: u64,
        num_steps: u16,
    ) -> Result<()> {
        let continuation = &mut ctx.accounts.continuation;
        continuation.owner = *ctx.accounts.owner.key;
        continuation.payer = *ctx.accounts.payer.key;

        continuation.input = *ctx.accounts.input.to_account_info().key;
        continuation.initial_amount_in = TokenAmount::new(ctx.accounts.input.mint, amount_in);
        continuation.output = *ctx.accounts.output.to_account_info().key;
        continuation.output_initial_balance = ctx.accounts.output.amount;

        continuation.amount_in = TokenAmount::new(ctx.accounts.input.mint, amount_in);
        continuation.minimum_amount_out =
            TokenAmount::new(ctx.accounts.output.mint, minimum_amount_out);
        continuation.steps_left = num_steps;

        let (_, nonce) = Pubkey::find_program_address(
            &[
                b"anchor".as_ref(),
                continuation.owner.as_ref(),
                ctx.accounts.random.key().as_ref(),
            ],
            &crate::ID,
        );
        continuation.__nonce = nonce;

        Ok(())
    }

    /// Begins a swap transaction.
    /// More optimized.
    pub fn begin_v2(
        ctx: Context<BeginV2>,
        amount_in: u64,
        minimum_amount_out: u64,
        num_steps: u16,
    ) -> Result<()> {
        let continuation = &mut ctx.accounts.continuation;
        continuation.owner = ctx.accounts.owner.key();
        continuation.payer = ctx.accounts.owner.key();

        continuation.input = ctx.accounts.input.key();
        continuation.initial_amount_in = TokenAmount::new(ctx.accounts.input.mint, amount_in);
        continuation.output = ctx.accounts.output.key();
        continuation.output_initial_balance = ctx.accounts.output.amount;

        continuation.amount_in = TokenAmount::new(ctx.accounts.input.mint, amount_in);
        continuation.minimum_amount_out =
            TokenAmount::new(ctx.accounts.output.mint, minimum_amount_out);
        continuation.steps_left = num_steps;
        Ok(())
    }

    /// Cleans up the transaction and checks several invariants.
    pub fn end(ctx: Context<End>) -> Result<()> {
        let continuation = &ctx.accounts.continuation;
        require!(continuation.steps_left == 0, EndIncomplete);

        let result_balance = ctx.accounts.output.amount;
        require!(
            result_balance >= continuation.output_initial_balance,
            BalanceLower
        );
        require!(
            ctx.accounts.output.mint == continuation.minimum_amount_out.mint,
            OutputMintMismatch,
        );

        let mut amount_out = result_balance - continuation.output_initial_balance;
        // if input token = output token, add the initial amount in to the difference
        if continuation.initial_amount_in.mint == ctx.accounts.output.mint {
            amount_out += continuation.initial_amount_in.amount;
        }

        require!(
            amount_out >= continuation.minimum_amount_out.amount,
            MinimumOutNotMet,
        );

        emit!(SwapCompleteEvent {
            owner: continuation.owner,
            amount_in: continuation.initial_amount_in,
            amount_out: TokenAmount::new(continuation.minimum_amount_out.mint, amount_out),
        });
        Ok(())
    }

    pub fn ss_swap<'info>(ctx: Context<'_, '_, '_, 'info, SSSwapAccounts<'info>>) -> Result<()> {
        process_action!(ctx)
    }

    pub fn ss_withdraw_one<'info>(
        ctx: Context<'_, '_, '_, 'info, SSWithdrawOneAccounts<'info>>,
    ) -> Result<()> {
        process_action!(ctx)
    }

    pub fn ss_deposit_a<'info>(
        ctx: Context<'_, '_, '_, 'info, SSDepositAAccounts<'info>>,
    ) -> Result<()> {
        process_action!(ctx)
    }

    pub fn ss_deposit_b<'info>(
        ctx: Context<'_, '_, '_, 'info, SSDepositBAccounts<'info>>,
    ) -> Result<()> {
        process_action!(ctx)
    }

    pub fn ad_withdraw<'info>(
        ctx: Context<'_, '_, '_, 'info, ADWithdrawAccounts<'info>>,
    ) -> Result<()> {
        process_action!(ctx)
    }

    pub fn ad_deposit<'info>(
        ctx: Context<'_, '_, '_, 'info, ADDepositAccounts<'info>>,
    ) -> Result<()> {
        process_action!(ctx)
    }
}

// --------------------------------
// Actions
// --------------------------------

#[router_action]
#[derive(Accounts)]
pub struct SSSwap<'info> {
    /// Swap and authority
    pub swap: StableSwap<'info>,
    /// The input token of this component of the route.
    pub input: SwapToken<'info>,
    /// The output token of this component of the route.
    pub output: SwapOutput<'info>,
}

#[router_action]
#[derive(Accounts)]
pub struct SSWithdrawOne<'info> {
    /// Swap and authority
    pub swap: StableSwap<'info>,
    /// The pool mint of the swap.
    #[account(mut)]
    pub pool_mint: AccountInfo<'info>,
    /// The input account for LP tokens.
    #[account(mut)]
    pub input_lp: Account<'info, TokenAccount>,
    /// The output of the unused token of this component of the route.
    #[account(mut)]
    pub quote_reserves: AccountInfo<'info>,
    /// The output of this component of the route.
    pub output: SwapOutput<'info>,
}

#[router_action]
#[derive(Accounts)]
pub struct SSDepositA<'info> {
    pub inner: SSDeposit<'info>,
}

#[router_action]
#[derive(Accounts)]
pub struct SSDepositB<'info> {
    pub inner: SSDeposit<'info>,
}

#[router_action(pass_through)]
#[derive(Accounts)]
pub struct ADWithdraw<'info> {
    pub input: Account<'info, TokenAccount>,
    pub output: Account<'info, TokenAccount>,
}

#[router_action(pass_through)]
#[derive(Accounts)]
pub struct ADDeposit<'info> {
    pub input: Account<'info, TokenAccount>,
    pub output: Account<'info, TokenAccount>,
}

// --------------------------------
// Instructions
// --------------------------------

/// Token accounts for the destination of a [StableSwap] instruction.
#[derive(Accounts)]
pub struct CreateATAIfNotExists<'info> {
    /// The token accounts of the user and the token.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The ATA to create.
    #[account(mut)]
    pub ata: UncheckedAccount<'info>,

    /// Authority of the created ATA.
    pub authority: UncheckedAccount<'info>,

    /// Mint.
    pub mint: UncheckedAccount<'info>,

    /// Rent.
    pub rent: Sysvar<'info, Rent>,

    /// System program.
    pub system_program: Program<'info, System>,

    /// Token program.
    pub token_program: Program<'info, Token>,

    /// The associated token program.
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
}

/// Begins a route.
#[derive(Accounts)]
pub struct Begin<'info> {
    /// Continuation state.
    #[account(
        init,
        seeds = [
            b"anchor".as_ref(),
            owner.key().as_ref(),
            random.key().as_ref()
        ],
        bump,
        payer = payer
    )]
    pub continuation: Box<Account<'info, Continuation>>,

    /// Nonce used for associating the continuation. Any arbitrary [Pubkey] can be passed here.
    pub random: UncheckedAccount<'info>,

    /// Input token account.
    #[account(has_one = owner)]
    pub input: Box<Account<'info, TokenAccount>>,

    /// Output token account.
    #[account(has_one = owner)]
    pub output: Box<Account<'info, TokenAccount>>,

    /// Owner of all token accounts in the chain.
    pub owner: Signer<'info>,

    /// Funds the continuation in the beginning transaction and receives
    /// the staked lamports of the continuation in the end transaction.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Rent sysvar.
    pub rent: Sysvar<'info, Rent>,

    /// System program.
    pub system_program: Program<'info, System>,
}

/// Begins a route.
#[derive(Accounts)]
pub struct BeginV2<'info> {
    /// Continuation state.
    #[account(zero)]
    pub continuation: Box<Account<'info, Continuation>>,

    /// Input token account.
    #[account(has_one = owner)]
    pub input: Box<Account<'info, TokenAccount>>,

    /// Output token account.
    #[account(has_one = owner)]
    pub output: Box<Account<'info, TokenAccount>>,

    /// Owner of all token accounts in the chain.
    pub owner: Signer<'info>,
}

/// Ends a route.
#[derive(Accounts)]
pub struct End<'info> {
    /// Continuation state.
    #[account(
        mut,
        close = payer,
        has_one = owner,
        has_one = payer,
        has_one = output,
    )]
    pub continuation: Box<Account<'info, Continuation>>,

    /// Output token account
    pub output: Box<Account<'info, TokenAccount>>,

    /// Owner of all accounts in the chain.
    pub owner: Signer<'info>,

    /// Funds the continuation in the beginning transaction and receives
    /// the staked lamports of the continuation in the end transaction.
    pub payer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SSSwapAccounts<'info> {
    pub continuation: ContinuationAccounts<'info>,
    pub action: SSSwap<'info>,
}

#[derive(Accounts)]
pub struct SSWithdrawOneAccounts<'info> {
    pub continuation: ContinuationAccounts<'info>,
    pub action: SSWithdrawOne<'info>,
}

#[derive(Accounts)]
pub struct SSDepositAAccounts<'info> {
    pub continuation: ContinuationAccounts<'info>,
    pub action: SSDepositA<'info>,
}

#[derive(Accounts)]
pub struct SSDepositBAccounts<'info> {
    pub continuation: ContinuationAccounts<'info>,
    pub action: SSDepositB<'info>,
}

#[derive(Accounts)]
pub struct ADWithdrawAccounts<'info> {
    pub continuation: ContinuationAccounts<'info>,
    pub action: ADWithdraw<'info>,
}

#[derive(Accounts)]
pub struct ADDepositAccounts<'info> {
    pub continuation: ContinuationAccounts<'info>,
    pub action: ADDeposit<'info>,
}

// --------------------------------
// Various accounts
// --------------------------------

/// Context common to all router operations.
#[derive(Accounts)]
pub struct ContinuationAccounts<'info> {
    /// Continuation state
    #[account(
        mut,
        has_one = owner,
    )]
    pub continuation: Box<Account<'info, Continuation>>,

    /// The spl_token program.
    pub token_program: Program<'info, Token>,

    /// The relevant swap program.
    pub swap_program: UncheckedAccount<'info>,

    /// The owner of all involved token accounts.
    pub owner: Signer<'info>,
}

/// Deposit accounts
#[derive(Accounts)]
pub struct SSDeposit<'info> {
    /// Swap and authority
    pub swap: StableSwap<'info>,
    /// The input of token A of this component of the route.
    pub input_a: SwapToken<'info>,
    /// The input of token B of this component of the route.
    pub input_b: SwapToken<'info>,
    /// The pool mint of the swap.
    #[account(mut)]
    pub pool_mint: AccountInfo<'info>,
    /// The destination account for LP tokens.
    #[account(mut)]
    pub output_lp: Account<'info, TokenAccount>,
}

/// Accounts for interacting with a StableSwap pool.
#[derive(Accounts)]
pub struct StableSwap<'info> {
    /// The swap account
    pub swap: AccountInfo<'info>,
    /// The authority of the swap.
    pub swap_authority: AccountInfo<'info>,
    /// The clock.
    pub clock: Sysvar<'info, Clock>,
}

/// Token accounts for a [StableSwap] instruction.
#[derive(Accounts)]
pub struct SwapToken<'info> {
    /// The token account associated with the user.
    #[account(mut)]
    pub user: Box<Account<'info, TokenAccount>>,
    /// The token account for the pool's reserves of this token.
    #[account(mut)]
    pub reserve: AccountInfo<'info>,
}

/// Token accounts for the destination of a [StableSwap] instruction.
#[derive(Accounts)]
pub struct SwapOutput<'info> {
    /// The token accounts of the user and the token.
    pub user_token: SwapToken<'info>,
    /// The token account for the fees associated with the token.
    #[account(mut)]
    pub fees: AccountInfo<'info>,
}

/// Continuation state of the owner.
#[account]
#[derive(Default)]
pub struct Continuation {
    /// The owner of the continuation.
    pub owner: Pubkey,

    /// The payer of the continuation.
    pub payer: Pubkey,

    /// The initial amount of tokens in.
    pub initial_amount_in: TokenAmount,

    /// The next input account.
    pub input: Pubkey,

    /// The next amount of tokens to input.
    pub amount_in: TokenAmount,

    /// The total number of steps that still need to be executed.
    pub steps_left: u16,

    /// The final output account.
    pub output: Pubkey,

    /// The initial balance of the output account.
    pub output_initial_balance: u64,

    /// The minimum amount of tokens to output at the end of the transaction.
    pub minimum_amount_out: TokenAmount,

    /// Nonce field to the struct to hold the bump seed for the program derived address,
    /// sourced from `<https://github.com/project-serum/anchor/blob/ec6888a3b9f702bc41bd3266e7dd70116df3549c/lang/attribute/account/src/lib.rs#L220-L221.>`.
    __nonce: u8,
}

/// --------------------------------
/// Error codes
/// --------------------------------
#[error_code]
pub enum ErrorCode {
    #[msg("Path input does not match prior output.")]
    PathInputOutputMismatch,
    #[msg("Error in a transitive swap input/output calculation.")]
    TransitiveSwapCalculationError,
    #[msg("Swap result overflowed when checking balance difference.")]
    OverflowSwapResult,
    #[msg("Swap resulted in a balance lower than the original balance.")]
    BalanceLower,
    #[msg("Cannot perform a zero swap.")]
    ZeroSwap,
    #[msg("Input owner does not match continuation owner.")]
    InputOwnerMismatch,
    #[msg("Input mint does not match continuation input mint.")]
    InputMintMismatch,
    #[msg("Output owner does not match continuation owner.")]
    OutputOwnerMismatch,
    #[msg("No more steps to process.")]
    NoMoreSteps,
    #[msg("Insufficient input balance")]
    InsufficientInputBalance,

    #[msg("Not all steps were processed.")]
    EndIncomplete,
    #[msg("Minimum amount out not met.")]
    MinimumOutNotMet,
    #[msg("Output mint does not match continuation output mint.")]
    OutputMintMismatch,
}

// --------------------------------
// Events
// --------------------------------

#[event]
pub struct SwapActionEvent {
    pub action_type: ActionType,
    pub owner: Pubkey,
    pub input_amount: TokenAmount,
    pub output_account: Pubkey,
    pub output_amount: TokenAmount,
}

#[event]
pub struct SwapCompleteEvent {
    pub owner: Pubkey,
    pub amount_in: TokenAmount,
    pub amount_out: TokenAmount,
}

/// An amount of tokens.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct TokenAmount {
    /// Mint of the token.
    pub mint: Pubkey,
    /// Amount of the token.
    pub amount: u64,
}

impl TokenAmount {
    fn new(mint: Pubkey, amount: u64) -> TokenAmount {
        TokenAmount { mint, amount }
    }
}

/// An action.
pub trait Action {
    const TYPE: ActionType;
}

/// Interface for programs that can be routed through.
#[interface]
pub trait RouterActionProcessor<'info, T: Accounts<'info>> {
    fn process_action(
        ctx: Context<T>,
        action: u16,
        amount_in: u64,
        minimum_amount_out: u64,
    ) -> Result<()>;
}

/// Represents a swap from one token to another.
#[derive(
    AnchorSerialize, AnchorDeserialize, IntoPrimitive, TryFromPrimitive, Copy, Clone, Debug,
)]
#[repr(u16)]
pub enum ActionType {
    SSSwap = 0,
    SSWithdrawOne = 1,
    SSDepositA = 2,
    SSDepositB = 3,

    ADWithdraw = 10,
    ADDeposit = 11,
}
