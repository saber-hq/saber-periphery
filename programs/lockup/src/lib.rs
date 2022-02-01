//! A token lockup program for linear release with cliff.
#![deny(rustdoc::all)]
#![allow(rustdoc::missing_doc_code_examples)]
#![allow(deprecated)]

/// Returns the program-derived-address seeds used for creating the associated
/// account.
macro_rules! associated_seeds {
    ($state:expr, $($with:expr),+) => {
        &[
            b"anchor".as_ref(),
            $($with),+,
            &[$state.nonce()],
        ]
    };
}

use anchor_lang::accounts::cpi_state::CpiState;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use mint_proxy::mint_proxy::MintProxy;
use mint_proxy::MinterInfo;
use vipers::unwrap_or_err;

pub mod calculator;

declare_id!("LockKXdYQVMbhhckwH3BxoYJ9FYatcZjwNGEuCwY33Q");

/// Saber token lockup program.
#[program]
pub mod lockup {
    use super::*;

    #[state]
    pub struct Lockup {
        /// Owner that controls/creates the lockup.
        pub owner: Pubkey,
        /// Next owner.
        pub pending_owner: Pubkey,
    }

    impl Lockup {
        /// Initializes the [Lockup].
        pub fn new(ctx: Context<Initialize>) -> Result<Lockup> {
            Ok(Lockup {
                owner: ctx.accounts.auth.owner.key(),
                pending_owner: Pubkey::default(),
            })
        }

        /// Creates a new [Release].
        #[access_control(check_auth(self, &ctx.accounts.auth))]
        pub fn create_release(
            &self,
            ctx: Context<CreateRelease>,
            release_amount: u64,
            start_ts: i64,
            end_ts: i64,
        ) -> Result<()> {
            require!(release_amount != 0, InvalidDepositAmount);
            require!(is_valid_schedule(start_ts, end_ts), InvalidSchedule);

            // minter_info validations
            require!(
                *ctx.accounts.minter_info.to_account_info().owner
                    == ctx.accounts.mint_proxy_program.key(),
                MinterInfoProgramMismatch
            );
            require!(
                ctx.accounts.minter_info.allowance >= release_amount,
                MinterAllowanceTooLow
            );
            require!(
                ctx.accounts.minter_info.minter == ctx.accounts.release.key(),
                MinterUnauthorized
            );

            let release = &mut ctx.accounts.release;
            release.beneficiary = ctx.accounts.beneficiary.key();
            release.mint = ctx.accounts.mint.key();
            release.mint_proxy_program = ctx.accounts.mint_proxy_program.key();
            release.minter_info = ctx.accounts.minter_info.key();
            release.start_balance = release_amount;
            release.end_ts = end_ts;
            release.start_ts = start_ts;
            release.created_ts = Clock::get()?.unix_timestamp;
            release.outstanding = release_amount;

            let (_, nonce) = Pubkey::find_program_address(
                &[b"anchor".as_ref(), release.beneficiary.key().as_ref()],
                &crate::ID,
            );
            release.__nonce = nonce;

            emit!(ReleaseCreatedEvent {
                beneficiary: release.beneficiary,
                mint: release.mint,
                release_amount,
                created_at: release.created_ts,
                start_at: release.start_ts,
                end_at: release.end_ts,
            });

            Ok(())
        }

        /// Revokes a [Release].
        #[access_control(check_auth(self, &ctx.accounts.auth))]
        pub fn revoke_release(&self, ctx: Context<RevokeRelease>) -> ProgramResult {
            require!(
                ctx.accounts.release.outstanding == ctx.accounts.release.start_balance,
                ReleaseAlreadyRedeemedFrom
            );
            Ok(())
        }

        /// Transfers ownership of the [Lockup] to another account.
        #[access_control(check_auth(self, &ctx.accounts))]
        pub fn transfer_ownership(&mut self, ctx: Context<Auth>, next_owner: Pubkey) -> Result<()> {
            self.pending_owner = next_owner;
            Ok(())
        }

        /// Accepts the new ownership of the [Lockup].
        pub fn accept_ownership(&mut self, ctx: Context<Auth>) -> Result<()> {
            require!(ctx.accounts.owner.is_signer, Unauthorized);
            require!(
                self.pending_owner == ctx.accounts.owner.key(),
                PendingOwnerMismatch
            );
            self.owner = self.pending_owner;
            self.pending_owner = Pubkey::default();
            Ok(())
        }

        /// Withdraws all available [Release] tokens.
        pub fn withdraw(&self, ctx: Context<Withdraw>) -> ProgramResult {
            ctx.accounts.validate()?;

            // calculate amount to withdraw
            let release = &ctx.accounts.release;
            let amount =
                calculator::available_for_withdrawal(release, Clock::get()?.unix_timestamp);
            require!(
                ctx.accounts.minter_info.allowance >= amount,
                MinterAllowanceTooLow
            );

            // Mint rewards
            let cpi_accounts = mint_proxy::cpi::accounts::PerformMint {
                proxy_mint_authority: ctx.accounts.proxy_mint_authority.to_account_info(),
                minter: ctx.accounts.release.to_account_info(),
                token_mint: ctx.accounts.token_mint.to_account_info(),
                destination: ctx.accounts.token_account.to_account_info(),
                minter_info: ctx.accounts.minter_info.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            };
            let beneficiary_key = ctx.accounts.beneficiary.key().to_bytes();
            let seeds = associated_seeds!(ctx.accounts.release, &beneficiary_key);
            let signer_seeds = &[&seeds[..]];
            let cpi_program = ctx.accounts.mint_proxy_program.to_account_info();
            let cpi_state_context =
                CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
            mint_proxy::invoke_perform_mint(
                cpi_state_context,
                ctx.accounts.mint_proxy_state.to_account_info(),
                amount,
            )?;

            // Bookkeeping.
            let release = &mut ctx.accounts.release;
            release.outstanding =
                unwrap_or_err!(release.outstanding.checked_sub(amount), U64Overflow);

            emit!(WithdrawEvent {
                beneficiary: release.beneficiary,
                mint: release.mint,
                outstanding_amount: release.outstanding,
                withdraw_amount: amount,
                timestamp: Clock::get()?.unix_timestamp
            });

            Ok(())
        }

        /// Withdraws tokens from the [Release] with an amount.
        pub fn withdraw_with_amount(&self, ctx: Context<Withdraw>, amount: u64) -> Result<()> {
            ctx.accounts.validate()?;

            let amount_released = calculator::available_for_withdrawal(
                &ctx.accounts.release,
                Clock::get()?.unix_timestamp,
            );
            // Has the given amount released?
            require!(amount <= amount_released, InsufficientWithdrawalBalance);
            // Enough mint allowance for mint?
            require!(
                ctx.accounts.minter_info.allowance >= amount,
                MinterAllowanceTooLow
            );

            // Mint rewards
            let cpi_accounts = mint_proxy::cpi::accounts::PerformMint {
                proxy_mint_authority: ctx.accounts.proxy_mint_authority.to_account_info(),
                minter: ctx.accounts.release.to_account_info(),
                token_mint: ctx.accounts.token_mint.to_account_info(),
                destination: ctx.accounts.token_account.to_account_info(),
                minter_info: ctx.accounts.minter_info.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            };
            let beneficiary_key = ctx.accounts.beneficiary.key().to_bytes();
            let seeds = associated_seeds!(ctx.accounts.release, &beneficiary_key);
            let signer_seeds = &[&seeds[..]];
            let cpi_program = ctx.accounts.mint_proxy_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
            mint_proxy::invoke_perform_mint(
                cpi_ctx,
                ctx.accounts.mint_proxy_state.to_account_info(),
                amount,
            )?;

            let release = &mut ctx.accounts.release;
            // Bookkeeping.
            release.outstanding =
                unwrap_or_err!(release.outstanding.checked_sub(amount), U64Overflow);

            emit!(WithdrawEvent {
                beneficiary: release.beneficiary,
                mint: release.mint,
                outstanding_amount: release.outstanding,
                withdraw_amount: amount,
                timestamp: Clock::get()?.unix_timestamp
            });

            Ok(())
        }
    }

    /// Convenience function for UI's to calculate the withdrawable amount.
    pub fn available_for_withdrawal(ctx: Context<AvailableForWithdrawal>) -> ProgramResult {
        let available = calculator::available_for_withdrawal(
            &ctx.accounts.release,
            ctx.accounts.clock.unix_timestamp,
        );
        // Log as string so that JS can read as a BN.
        msg!(&format!("{{ \"result\": \"{}\" }}", available));
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Auth<'info> {
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    pub auth: Auth<'info>,
    pub mint_proxy_state: CpiState<'info, MintProxy>,
    pub mint_proxy_program: Program<'info, mint_proxy::program::MintProxy>,
}

#[derive(Accounts)]
pub struct CreateRelease<'info> {
    /// Authentication for authority of the [lockup::Lockup].
    pub auth: Auth<'info>,
    /// Minter info account.
    pub minter_info: Account<'info, MinterInfo>,
    /// Account able to withdraw from the [Release].
    pub beneficiary: UncheckedAccount<'info>,
    /// [Release] account.
    #[account(
        init,
        seeds = [
            b"anchor".as_ref(),
            beneficiary.key().as_ref()
        ],
        bump = Pubkey::find_program_address(
            &[
                b"anchor".as_ref(),
                beneficiary.key().as_ref()
            ],
            &crate::ID
        ).1,
        payer = payer
    )]
    pub release: Account<'info, Release>,
    /// Token to be released.
    pub mint: Account<'info, Mint>,
    /// Mint proxy program.
    pub mint_proxy_program: Program<'info, mint_proxy::program::MintProxy>,
    /// Payer for the [Release] account creation.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// System program.
    pub system_program: Program<'info, System>,
    /// Rent sysvar.
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct RevokeRelease<'info> {
    /// Authentication for authority of the [lockup::Lockup].
    pub auth: Auth<'info>,
    /// [Release] account.
    #[account(mut, close = payer)]
    pub release: Account<'info, Release>,
    /// Recipient of the [Release] account lamports.
    pub payer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// Mint authority of the proxy.
    pub proxy_mint_authority: UncheckedAccount<'info>,
    /// Mint of the token unlocked.
    #[account(mut)]
    pub token_mint: Account<'info, Mint>,
    /// Owner of the [Release].
    pub beneficiary: Signer<'info>,
    /// [Release].
    #[account(mut, has_one = beneficiary)]
    pub release: Account<'info, Release>,
    /// Beneficiary token account.
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,
    /// Token program.
    pub token_program: Program<'info, Token>,
    /// Clock sysvar, now unused and may be any account.
    pub unused_clock: UncheckedAccount<'info>,
    /// Minter info.
    #[account(mut)]
    pub minter_info: Account<'info, MinterInfo>,
    /// Mint proxy program.
    pub mint_proxy_program: Program<'info, mint_proxy::program::MintProxy>,
    /// Mint proxy state.
    pub mint_proxy_state: CpiState<'info, mint_proxy::mint_proxy::MintProxy>,
}

impl<'info> Withdraw<'info> {
    fn validate(&self) -> ProgramResult {
        // proxy_mint_authority validations
        require!(
            self.proxy_mint_authority.key() == self.mint_proxy_state.proxy_mint_authority,
            ProxyMintAuthorityMismatch
        );

        // token_mint validations
        require!(self.token_mint.key() == self.release.mint, InvalidTokenMint);
        require!(
            self.token_mint.key() == self.mint_proxy_state.token_mint,
            MintProxyMintMismatch
        );

        // beneficiary validations
        require!(
            self.beneficiary.key() == self.release.beneficiary,
            InvalidBeneficiary,
        );
        require!(self.beneficiary.is_signer, InvalidBeneficiary);

        // release validations
        require!(
            self.release.key() == self.minter_info.minter,
            ReleaseMismatch,
        );

        // token_account validations
        require!(
            self.token_account.mint == self.release.mint,
            DestinationMintMismatch,
        );

        // token_program validations
        require!(self.token_program.key() == token::ID, TokenProgramMismatch,);

        // minter_info validations
        require!(
            self.minter_info.key() == self.release.minter_info,
            MinterInfoMismatch
        );

        // mint_proxy_program validations
        require!(
            self.mint_proxy_program.key() == self.release.mint_proxy_program,
            InvalidMintProxyProgram
        );

        Ok(())
    }
}

#[derive(Accounts)]
pub struct AvailableForWithdrawal<'info> {
    pub release: Account<'info, Release>,
    pub clock: Sysvar<'info, Clock>,
}

/// Contains information about a beneficiary and the tokens it can claim
/// + its release schedule.
#[account]
#[derive(Default)]
pub struct Release {
    /// The owner of this [Release] account.
    pub beneficiary: Pubkey,
    /// The mint of the SPL token locked up.
    pub mint: Pubkey,
    /// The mint proxy program.
    pub mint_proxy_program: Pubkey,
    /// The [mint_proxy::MinterInfo].
    pub minter_info: Pubkey,
    /// The outstanding SBR deposit backing this release account. All
    /// withdrawals will deduct this balance.
    pub outstanding: u64,
    /// The starting balance of this release account, i.e., how much was
    /// originally deposited.
    pub start_balance: u64,
    /// The unix timestamp at which this release account was created.
    pub created_ts: i64,
    /// The time at which release begins.
    pub start_ts: i64,
    /// The time at which all tokens are released.
    pub end_ts: i64,
    /// Nonce field to the struct to hold the bump seed for the program derived address,
    /// sourced from `<https://github.com/project-serum/anchor/blob/ec6888a3b9f702bc41bd3266e7dd70116df3549c/lang/attribute/account/src/lib.rs#L220-L221.>`.
    __nonce: u8,
}

impl Release {
    /// Gets the nonce.
    pub fn nonce(&self) -> u8 {
        self.__nonce
    }
}

fn check_auth(lockup: &Lockup, auth: &Auth) -> Result<()> {
    require!(
        auth.owner.is_signer && lockup.owner == auth.owner.key(),
        Unauthorized
    );
    Ok(())
}

#[event]
pub struct ReleaseCreatedEvent {
    #[index]
    pub beneficiary: Pubkey,
    #[index]
    pub mint: Pubkey,

    pub release_amount: u64,
    pub created_at: i64,
    pub start_at: i64,
    pub end_at: i64,
}

#[event]
pub struct WithdrawEvent {
    #[index]
    pub beneficiary: Pubkey,
    #[index]
    pub mint: Pubkey,

    pub outstanding_amount: u64,
    pub withdraw_amount: u64,
    pub timestamp: i64,
}

#[error]
pub enum ErrorCode {
    #[msg("The provided beneficiary was not valid.")]
    InvalidBeneficiary,
    #[msg("The release deposit amount must be greater than zero.")]
    InvalidDepositAmount,
    #[msg("The Whitelist entry is not a valid program address.")]
    InvalidProgramAddress,
    #[msg("Invalid release schedule given.")]
    InvalidSchedule,
    #[msg("The provided token mint did not match the mint on the release account.")]
    InvalidTokenMint,
    #[msg("Insufficient withdrawal balance.")]
    InsufficientWithdrawalBalance,
    #[msg("Unauthorized access.")]
    Unauthorized,
    #[msg("Pending owner mismatch.")]
    PendingOwnerMismatch,
    #[msg("The mint proxy program provided was not valid.")]
    InvalidMintProxyProgram,
    #[msg("The Release must be an authorized minter on the mint proxy.")]
    MinterUnauthorized,
    #[msg("The minter info is not owned by the expected mint proxy.")]
    MinterInfoProgramMismatch,
    #[msg("The minter must have an allowance of at least the release amount.")]
    MinterAllowanceTooLow,
    #[msg("Minter info mismatch")]
    MinterInfoMismatch,

    #[msg("Release mismatch")]
    ReleaseMismatch,
    #[msg("Proxy mint authority mismatch")]
    ProxyMintAuthorityMismatch,
    #[msg("Mint proxy mint mismatch")]
    MintProxyMintMismatch,
    #[msg("Withdraw destination mint mismatch")]
    DestinationMintMismatch,
    #[msg("Token program mismatch")]
    TokenProgramMismatch,
    #[msg("Release already redeemed from")]
    ReleaseAlreadyRedeemedFrom,

    #[msg("U64 overflow.")]
    U64Overflow,
}

pub fn is_valid_schedule(start_ts: i64, end_ts: i64) -> bool {
    end_ts > start_ts
}
