//! Events.

use anchor_lang::prelude::*;

/// Called when a new token wrapper is initialized.
#[event]
pub struct InitEvent {
    /// User that paid to create the token.
    #[index]
    pub payer: Pubkey,

    /// Number of decimals of the wrapped token.
    pub decimals: u8,
    /// Amount to multiply by to wrap the token. Cached here for performance reasons, but equivalent to 10 **decimals
    pub multiplier: u64,
    /// Mint of the underlying token.
    pub wrapper_underlying_mint: Pubkey,
    /// Token account holding the underlying token.
    pub wrapper_underlying_tokens: Pubkey,
    /// Mint of the token of this wrapper.
    pub wrapper_mint: Pubkey,
}

/// Called when tokens are deposited into the wrapper.
#[event]
pub struct DepositEvent {
    /// Owner of the account that deposited.
    #[index]
    pub owner: Pubkey,
    /// Underlying token mint
    #[index]
    pub underlying_mint: Pubkey,
    /// Wrapped token mint
    #[index]
    pub wrapped_mint: Pubkey,
    /// Amount deposited.
    pub deposit_amount: u64,
    /// Wrapped tokens minted.
    pub mint_amount: u64,
}

/// Called when tokens are withdrawn from the wrapper.
#[event]
pub struct WithdrawEvent {
    /// Owner of the account that withdrew.
    #[index]
    pub owner: Pubkey,
    /// Underlying token mint
    #[index]
    pub underlying_mint: Pubkey,
    /// Wrapped token mint
    #[index]
    pub wrapped_mint: Pubkey,
    /// Amount withdrawn.
    pub withdraw_amount: u64,
    /// Wrapped tokens burned.
    pub burn_amount: u64,
    /// Wrapped tokens remaining as dust.
    pub dust_amount: u64,
}
