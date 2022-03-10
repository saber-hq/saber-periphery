use anchor_lang::prelude::*;
use anchor_spl::token;

/// Returns the program-derived-address seeds used for creating the associated
/// account.
#[macro_export]
macro_rules! associated_seeds {
    ($state:expr, $($with:expr),+) => {
        &[
            b"anchor".as_ref(),
            $($with),+,
        ]
    };
}

use crate::UserStake;

/// Creates a token instruction signed by the user.
macro_rules! perform_as_user {
    ($self:expr, $method:ident, $accounts:expr, $amount:expr) => {{
        let cpi_program = $self.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, $accounts);
        token::$method(cpi_ctx, $amount)
    }};
}

/// Creates a token instruction performed by the wrapper.
macro_rules! perform_as_wrapper {
    ($self:expr, $accounts:expr, $method:ident, $amount:expr) => {{
        let seeds = $crate::associated_seeds!(
            $self.wrapper,
            $self.wrapper.wrapper_underlying_mint.as_ref(),
            &[$self.wrapper.decimals],
            &[$self.wrapper.nonce()]
        );
        let signer = &[&seeds[..]];
        let cpi_program = $self.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, $accounts, signer);
        token::$method(cpi_ctx, $amount)
    }};
}

/// Helper methods for interacting with the user stake.
impl<'info> UserStake<'info> {
    /// Transfer user's tokens to wrapper.
    pub fn deposit_underlying(&self, amount: u64) -> Result<()> {
        let cpi_accounts = token::Transfer {
            from: self.user_underlying_tokens.to_account_info(),
            to: self.wrapper_underlying_tokens.to_account_info(),
            authority: self.owner.to_account_info(),
        };
        perform_as_user!(self, transfer, cpi_accounts, amount)
    }

    /// Burn user's wrapper tokens.
    pub fn burn_wrapped(&self, amount: u64) -> Result<()> {
        let cpi_accounts = token::Burn {
            mint: self.wrapper_mint.to_account_info(),
            to: self.user_wrapped_tokens.to_account_info(),
            authority: self.owner.to_account_info(),
        };
        perform_as_user!(self, burn, cpi_accounts, amount)
    }

    /// Mint wrapped tokens to user wrapped token account.
    pub fn mint_wrapped(&self, amount: u64) -> Result<()> {
        let cpi_accounts = token::MintTo {
            mint: self.wrapper_mint.to_account_info(),
            to: self.user_wrapped_tokens.to_account_info(),
            authority: self.wrapper.to_account_info(),
        };
        perform_as_wrapper!(self, cpi_accounts, mint_to, amount)
    }

    /// Transfer underlying tokens from wrapper to user.
    pub fn withdraw_underlying(&self, amount: u64) -> Result<()> {
        let cpi_accounts = token::Transfer {
            from: self.wrapper_underlying_tokens.to_account_info(),
            to: self.user_underlying_tokens.to_account_info(),
            authority: self.wrapper.to_account_info(),
        };
        perform_as_wrapper!(self, cpi_accounts, transfer, amount)
    }
}
