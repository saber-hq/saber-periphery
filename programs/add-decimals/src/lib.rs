//! Wraps another token to give it more decimals.
//!
//! The resulting token is an SPL Token that has more decimals than
//! its underlying token.
#![deny(clippy::unwrap_used)]
#![deny(rustdoc::all)]
#![allow(rustdoc::missing_doc_code_examples)]

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use continuation_router::{ActionType, RouterActionProcessor};
use std::convert::TryFrom;
use vipers::{assert_keys_eq, unwrap_int, Validate};
use vipers::{program_err, try_or_err, unwrap_or_err};

mod events;
mod transfer;

pub use events::*;

declare_id!("DecZY86MU5Gj7kppfUCEmd4LbXXuyZH1yHaP2NTqdiZB");

#[allow(deprecated)]
#[program]
/// Decimal wrapper program.
pub mod add_decimals {
    use super::*;

    /// Initializes a new wrapper.
    ///
    /// The wrapper is an associated account with the seeds:
    /// - token_program (the pubkey of the SPL token program)
    /// - underlying_mint (mint of the underlying asset)
    /// - decimals (the number of decimals, must be greater than the decimals of the underlying's mint)
    ///
    /// Anyone can initialize a new wrapper. To do so:
    /// 1. Compute the address of the new wrapper
    /// 2. Initialize an account for the wrapper to hold the underlying tokens.
    /// 3. Initialize a mint for the wrapper. It is recommended to use a vanity address via `solana-keygen grind`.
    /// 4. Run the initialize_wrapper instruction.
    #[access_control(ctx.accounts.validate())]
    pub fn initialize_wrapper(ctx: Context<InitializeWrapper>, nonce: u8) -> ProgramResult {
        let decimals = ctx.accounts.wrapper_mint.decimals;
        require!(
            decimals >= ctx.accounts.underlying_mint.decimals,
            InitWrapperDecimalsTooLow
        );

        let added_decimals =
            unwrap_int!(decimals.checked_sub(ctx.accounts.underlying_mint.decimals));
        let multiplier = unwrap_or_err!(
            10u64.checked_pow(added_decimals as u32),
            InitMultiplierOverflow
        );

        let wrapper = &mut ctx.accounts.wrapper;
        wrapper.__nonce = nonce;
        wrapper.decimals = decimals;
        wrapper.multiplier = multiplier;
        wrapper.wrapper_underlying_mint = ctx.accounts.underlying_mint.key();
        wrapper.wrapper_underlying_tokens = ctx.accounts.wrapper_underlying_tokens.key();
        wrapper.wrapper_mint = ctx.accounts.wrapper_mint.key();

        emit!(InitEvent {
            payer: ctx.accounts.payer.key(),
            decimals,
            multiplier,
            wrapper_underlying_mint: wrapper.wrapper_underlying_mint,
            wrapper_underlying_tokens: wrapper.wrapper_underlying_tokens,
            wrapper_mint: wrapper.wrapper_mint,
        });
        Ok(())
    }

    /// Deposits underlying tokens to mint wrapped tokens.
    #[access_control(ctx.accounts.validate())]
    pub fn deposit(ctx: Context<UserStake>, deposit_amount: u64) -> ProgramResult {
        require!(deposit_amount > 0, ZeroAmount);
        require!(
            ctx.accounts.user_underlying_tokens.amount >= deposit_amount,
            InsufficientUnderlyingBalance
        );

        let mint_amount = unwrap_or_err!(
            ctx.accounts.wrapper.to_wrapped_amount(deposit_amount),
            MintAmountOverflow
        );

        // Deposit underlying and mint wrapped
        ctx.accounts.deposit_underlying(deposit_amount)?;
        ctx.accounts.mint_wrapped(mint_amount)?;

        emit!(DepositEvent {
            owner: ctx.accounts.user_underlying_tokens.owner,
            underlying_mint: ctx.accounts.user_underlying_tokens.mint,
            wrapped_mint: ctx.accounts.user_wrapped_tokens.mint,
            deposit_amount,
            mint_amount
        });
        Ok(())
    }

    /// Deposits wrapped tokens to withdraw underlying tokens.
    #[access_control(ctx.accounts.validate())]
    pub fn withdraw(ctx: Context<UserStake>, max_burn_amount: u64) -> ProgramResult {
        require!(max_burn_amount > 0, ZeroAmount);
        require!(
            ctx.accounts.user_wrapped_tokens.amount >= max_burn_amount,
            InsufficientWrappedBalance
        );

        // Compute true withdraw amount
        let withdraw_amount = unwrap_or_err!(
            ctx.accounts.wrapper.to_underlying_amount(max_burn_amount),
            InvalidWithdrawAmount
        );
        let burn_amount = unwrap_or_err!(
            ctx.accounts.wrapper.to_wrapped_amount(withdraw_amount),
            InvalidBurnAmount
        );
        let dust_amount = unwrap_int!(max_burn_amount.checked_sub(burn_amount));

        // Burn wrapped and withdraw underlying
        ctx.accounts.burn_wrapped(burn_amount)?;
        ctx.accounts.withdraw_underlying(withdraw_amount)?;

        emit!(WithdrawEvent {
            owner: ctx.accounts.user_underlying_tokens.owner,
            underlying_mint: ctx.accounts.user_underlying_tokens.mint,
            wrapped_mint: ctx.accounts.user_wrapped_tokens.mint,
            withdraw_amount,
            burn_amount,
            dust_amount,
        });
        Ok(())
    }

    /// Burn all wrapped tokens to withdraw the underlying tokens.
    pub fn withdraw_all(ctx: Context<UserStake>) -> ProgramResult {
        let max_burn_amount = ctx.accounts.user_wrapped_tokens.amount;
        withdraw(ctx, max_burn_amount)
    }

    #[state]
    pub struct AddDecimals;

    impl<'info> RouterActionProcessor<'info, UserStake<'info>> for AddDecimals {
        fn process_action(
            ctx: Context<UserStake>,
            action: u16,
            amount_in: u64,
            _minimum_amount_out: u64,
        ) -> ProgramResult {
            let action_type = try_or_err!(ActionType::try_from(action), UnknownAction);
            msg!("Router action received: {:?}", action_type);
            match action_type {
                ActionType::ADWithdraw => withdraw(ctx, amount_in),
                ActionType::ADDeposit => deposit(ctx, amount_in),
                _ => program_err!(UnknownAction),
            }
        }
    }
}

// --------------------------------
// Instruction accounts
// --------------------------------

/// Accounts for initializing a new wrapper.
#[derive(Accounts)]
#[instruction(nonce: u8)]
pub struct InitializeWrapper<'info> {
    /// The WrappedToken account.
    #[account(
        init,
        seeds = [
            b"anchor".as_ref(),
            underlying_mint.to_account_info().key.as_ref(),
            &[wrapper_mint.decimals]
        ],
        bump = nonce,
        payer = payer
    )]
    pub wrapper: Account<'info, WrappedToken>,

    /// Token account containing the underlying tokens.
    pub wrapper_underlying_tokens: Account<'info, TokenAccount>,

    /// Mint of the underlying token.
    pub underlying_mint: Account<'info, Mint>,

    /// Mint of the wrapper.
    pub wrapper_mint: Account<'info, Mint>,

    /// Payer of the newly created decimal wrapper.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Rent sysvar. Required for initialization.
    pub rent: Sysvar<'info, Rent>,

    /// System program. Required for initialization.
    pub system_program: Program<'info, System>,
}

impl<'info> InitializeWrapper<'info> {
    /// Validates ownership of the accounts of the wrapper.
    pub fn validate(&self) -> ProgramResult {
        // underlying account checks
        require!(
            self.wrapper_underlying_tokens.amount == 0,
            InitNonEmptyAccount
        );
        assert_keys_eq!(
            self.wrapper_underlying_tokens.owner,
            self.wrapper,
            InitWrapperUnderlyingOwnerMismatch
        );
        assert_keys_eq!(
            self.wrapper_underlying_tokens.mint,
            self.underlying_mint,
            InitWrapperUnderlyingMintMismatch
        );

        // mint checks
        assert_keys_eq!(
            self.wrapper_mint.mint_authority.unwrap(),
            self.wrapper,
            InitMintAuthorityMismatch
        );
        assert_keys_eq!(
            self.wrapper_mint.freeze_authority.unwrap(),
            self.wrapper,
            InitFreezeAuthorityMismatch
        );
        require!(self.wrapper_mint.supply == 0, InitWrapperSupplyNonZero);
        Ok(())
    }
}

/// Accounts for withdrawing or depositing into the wrapper.
#[derive(Accounts)]
pub struct UserStake<'info> {
    /// Wrapper account.
    pub wrapper: Account<'info, WrappedToken>,

    /// Mint of the wrapper.
    #[account(mut)]
    pub wrapper_mint: Account<'info, Mint>,

    /// Wrapper's token account containing the underlying tokens.
    #[account(mut)]
    pub wrapper_underlying_tokens: Account<'info, TokenAccount>,

    /// Owner of the user underlying token accounts.
    pub owner: Signer<'info>,

    /// User's token account for the underlying tokens.
    #[account(mut)]
    pub user_underlying_tokens: Account<'info, TokenAccount>,

    /// User's token account for wrapped tokens.
    #[account(mut)]
    pub user_wrapped_tokens: Account<'info, TokenAccount>,

    /// SPL Token program.
    pub token_program: Program<'info, Token>,
}

impl<'info> Validate<'info> for UserStake<'info> {
    /// Validates ownership of the accounts of the wrapper.
    fn validate(&self) -> ProgramResult {
        assert_keys_eq!(self.wrapper.wrapper_mint, self.wrapper_mint);
        assert_keys_eq!(
            self.wrapper.wrapper_underlying_tokens,
            self.wrapper_underlying_tokens
        );
        assert_keys_eq!(self.user_underlying_tokens.owner, self.owner);
        assert_keys_eq!(
            self.user_underlying_tokens.mint,
            self.wrapper.wrapper_underlying_mint
        );
        assert_keys_eq!(self.user_wrapped_tokens.owner, self.owner);
        assert_keys_eq!(self.user_wrapped_tokens.mint, self.wrapper_mint);
        Ok(())
    }
}

/// Contains the info of a wrapped token. Immutable.
///
/// There are two tokens here:
/// - the underlying token, which is the original token
/// - the wrapped token, which is the token created that has a different number of decimals
#[account]
#[derive(Copy, Debug, Default)]
pub struct WrappedToken {
    /// Number of decimals of the wrapped token.
    pub decimals: u8,
    /// Amount to multiply by to wrap the token.
    /// Cached here for performance reasons, but equivalent to `10 ** decimals`.
    pub multiplier: u64,
    /// Mint of the underlying token.
    pub wrapper_underlying_mint: Pubkey,
    /// Program token account holding the underlying token.
    pub wrapper_underlying_tokens: Pubkey,
    /// Mint of the token of this wrapper.
    pub wrapper_mint: Pubkey,
    /// Nonce field to the struct to hold the bump seed for the program derived address,
    /// sourced from `<https://github.com/project-serum/anchor/blob/ec6888a3b9f702bc41bd3266e7dd70116df3549c/lang/attribute/account/src/lib.rs#L220-L221.>`.
    __nonce: u8,
}

impl WrappedToken {
    pub fn to_wrapped_amount(&self, amount: u64) -> Option<u64> {
        self.multiplier.checked_mul(amount)
    }

    pub fn to_underlying_amount(&self, amount: u64) -> Option<u64> {
        amount.checked_div(self.multiplier)
    }

    /// Gets the nonce.
    pub fn nonce(&self) -> u8 {
        self.__nonce
    }
}

/// Errors.
#[error]
#[derive(Eq, PartialEq)]
pub enum ErrorCode {
    #[msg("Wrapper underlying tokens account must be empty.")]
    InitNonEmptyAccount,
    #[msg("Supply of the wrapper mint is non-zero")]
    InitWrapperSupplyNonZero,
    #[msg("Owner of the wrapper underlying tokens account must be the wrapper")]
    InitWrapperUnderlyingOwnerMismatch,
    #[msg("Underlying mint does not match underlying tokens account mint")]
    InitWrapperUnderlyingMintMismatch,
    #[msg("Mint authority mismatch")]
    InitMintAuthorityMismatch,
    #[msg("Initial decimals too high")]
    InitMultiplierOverflow,
    #[msg("The number of target decimals must be greater than or equal to the underlying asset's decimals.")]
    InitWrapperDecimalsTooLow,

    #[msg("Mint amount overflow. This error happens when the token cannot support this many decimals added to the token.")]
    MintAmountOverflow,
    #[msg("Failed to convert burn amount from withdraw amount.")]
    InvalidBurnAmount,
    #[msg("Failed to convert withdraw amount from wrapped amount.")]
    InvalidWithdrawAmount,
    #[msg("User does not have enough underlying tokens")]
    InsufficientUnderlyingBalance,
    #[msg("User does not have enough wrapped tokens")]
    InsufficientWrappedBalance,
    #[msg("Cannot send zero tokens")]
    ZeroAmount,

    #[msg("Unknown router action")]
    UnknownAction,

    #[msg("Freeze authority mismatch")]
    InitFreezeAuthorityMismatch,
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod test {
    use super::*;
    use proptest::prelude::*;

    const MAX_TOKEN_DECIMALS: u8 = 9;

    proptest! {
        #[test]
        fn test_wrapped_token(
            nonce in 0..u8::MAX,
            amount in 0..u64::MAX,
            (underlying, desired) in underlying_and_desired(),
        ) {
            let added_decimals = desired - underlying;
            let multiplier = 10u64.checked_pow(added_decimals as u32);
            prop_assume!(multiplier.is_some());

            let wrapped_token = WrappedToken {
                __nonce: nonce,
                decimals: desired,
                multiplier: multiplier.unwrap(),
                wrapper_underlying_mint: Pubkey::default(),
                wrapper_underlying_tokens: Pubkey::default(),
                wrapper_mint: Pubkey::default(),
            };
            let wrapped_amount = wrapped_token.to_wrapped_amount(amount);
            if wrapped_amount.is_some() {
                assert_eq!(wrapped_amount.unwrap() / amount, wrapped_token.multiplier);
                assert_eq!(wrapped_token.to_underlying_amount(wrapped_amount.unwrap()).unwrap(), amount);
            }
        }
    }

    prop_compose! {
        fn underlying_and_desired()
            (desired in 0..=MAX_TOKEN_DECIMALS)
            (underlying in 0..=desired, desired in Just(desired)) -> (u8, u8) {
                (underlying, desired)
        }
    }
}
