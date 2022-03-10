//! Redeems Quarry IOU tokens for Saber tokens via the Saber mint proxy.
#![deny(rustdoc::all)]
#![allow(rustdoc::missing_doc_code_examples)]
#![allow(deprecated)]

use anchor_lang::accounts::cpi_state::CpiState;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use mint_proxy::mint_proxy::MintProxy;
use mint_proxy::MinterInfo;
use vipers::validate::Validate;

mod account_validators;
mod macros;
mod mut_token_pair;

declare_id!("RDM23yr8pr1kEAmhnFpaabPny6C9UVcEcok3Py5v86X");

#[program]
/// [redeemer] program.
pub mod redeemer {
    use super::*;

    /// Initializes the [Redeemer].
    #[access_control(ctx.accounts.validate())]
    pub fn create_redeemer(ctx: Context<CreateRedeemer>, _bump: u8) -> Result<()> {
        let tokens = &ctx.accounts.tokens;
        let redeemer = &mut ctx.accounts.redeemer;
        redeemer.bump = *ctx.bumps.get("redeemer").unwrap();
        redeemer.iou_mint = tokens.iou_mint.key();
        redeemer.redemption_mint = tokens.redemption_mint.key();
        redeemer.redemption_vault = tokens.redemption_vault.key();

        Ok(())
    }

    /// Redeems some of a user's tokens from the redemption vault.
    #[access_control(ctx.accounts.validate())]
    pub fn redeem_tokens(ctx: Context<RedeemTokens>, amount: u64) -> Result<()> {
        ctx.accounts.tokens.burn_iou_tokens(
            ctx.accounts.iou_source.to_account_info(),
            ctx.accounts.source_authority.to_account_info(),
            amount,
        )?;

        let cpi_accounts = token::Transfer {
            from: ctx.accounts.tokens.redemption_vault.to_account_info(),
            to: ctx.accounts.redemption_destination.to_account_info(),
            authority: ctx.accounts.redeemer.to_account_info(),
        };

        let seeds = gen_redeemer_signer_seeds!(ctx.accounts.redeemer);
        let signer_seeds = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.tokens.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;

        let redeemer = &ctx.accounts.redeemer;
        emit!(RedeemTokensEvent {
            user: *ctx.accounts.source_authority.key,
            iou_mint: redeemer.iou_mint,
            destination_mint: redeemer.redemption_mint,
            amount,
        });

        Ok(())
    }

    /// Redeems an amount of a user's tokens against the mint proxy.
    pub fn redeem_tokens_from_mint_proxy(
        ctx: Context<RedeemTokensFromMintProxy>,
        amount: u64,
    ) -> Result<()> {
        ctx.accounts.validate()?;
        ctx.accounts.redeem_ctx.tokens.burn_iou_tokens(
            ctx.accounts.redeem_ctx.iou_source.to_account_info(),
            ctx.accounts.redeem_ctx.source_authority.to_account_info(),
            amount,
        )?;

        let redeemer = &ctx.accounts.redeem_ctx.redeemer;
        let seeds = gen_redeemer_signer_seeds!(redeemer);
        let signer_seeds = &[&seeds[..]];
        // Mint the tokens.
        let cpi_accounts = mint_proxy::cpi::accounts::PerformMint {
            proxy_mint_authority: ctx.accounts.proxy_mint_authority.to_account_info(),
            minter: ctx.accounts.redeem_ctx.redeemer.to_account_info(),
            token_mint: ctx
                .accounts
                .redeem_ctx
                .tokens
                .redemption_mint
                .to_account_info(),
            destination: ctx
                .accounts
                .redeem_ctx
                .redemption_destination
                .to_account_info(),
            minter_info: ctx.accounts.minter_info.to_account_info(),
            token_program: ctx
                .accounts
                .redeem_ctx
                .tokens
                .token_program
                .to_account_info(),
        };
        let cpi_program = ctx.accounts.mint_proxy_program.to_account_info();
        mint_proxy::invoke_perform_mint(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds),
            ctx.accounts.mint_proxy_state.to_account_info(),
            amount,
        )?;

        emit!(RedeemTokensEvent {
            user: *ctx.accounts.redeem_ctx.source_authority.key,
            iou_mint: redeemer.iou_mint,
            destination_mint: redeemer.redemption_mint,
            amount,
        });

        Ok(())
    }

    /// Redeems all of a user's tokens against the mint proxy.
    pub fn redeem_all_tokens_from_mint_proxy(
        ctx: Context<RedeemTokensFromMintProxy>,
    ) -> Result<()> {
        let amount = ctx.accounts.redeem_ctx.iou_source.amount;
        redeem_tokens_from_mint_proxy(ctx, amount)
    }
}

// --------------------------------
// Accounts
// --------------------------------

/// Allows redeeming the [Redeemer::iou_mint] for the [Redeemer::redemption_mint].
#[account]
#[derive(Default)]
pub struct Redeemer {
    /// Bump seed.
    pub bump: u8,
    /// ...
    pub iou_mint: Pubkey,
    /// ...
    pub redemption_mint: Pubkey,
    /// ...
    pub redemption_vault: Pubkey,
}

// --------------------------------
// Instructions
// --------------------------------

/// Token-related accounts with mutation.
#[derive(Accounts)]
pub struct MutTokenPair<'info> {
    /// Mint of the IOU token.
    #[account(mut)]
    pub iou_mint: Account<'info, Mint>,
    /// Mint of the redemption token.
    #[account(mut)]
    pub redemption_mint: Account<'info, Mint>,
    /// Vault of the redemption token.
    #[account(mut)]
    pub redemption_vault: Account<'info, TokenAccount>,
    /// The spl_token program.
    pub token_program: Program<'info, Token>,
}

/// Token-related accounts without mutation.
#[derive(Accounts)]
pub struct ReadonlyTokenPair<'info> {
    /// Mint of the IOU token.
    pub iou_mint: Account<'info, Mint>,
    /// Mint of the redemption token.
    pub redemption_mint: Account<'info, Mint>,
    /// Vault of the redemption token.
    pub redemption_vault: Account<'info, TokenAccount>,
}

/// Accounts for [redeemer::create_redeemer]
#[derive(Accounts)]
pub struct CreateRedeemer<'info> {
    /// Redeemer PDA.
    #[account(
        init,
        seeds = [
            b"Redeemer".as_ref(),
            tokens.iou_mint.to_account_info().key.as_ref(),
            tokens.redemption_mint.to_account_info().key.as_ref()
        ],
        bump,
        payer = payer
    )]
    pub redeemer: Account<'info, Redeemer>,
    /// Tokens to use.
    pub tokens: ReadonlyTokenPair<'info>,
    /// Payer.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// System program.
    pub system_program: Program<'info, System>,
}

/// Accounts for [redeemer::redeem_tokens].
#[derive(Accounts)]
pub struct RedeemTokens<'info> {
    /// Redeemer PDA.
    pub redeemer: Account<'info, Redeemer>,
    /// Tokens.
    pub tokens: MutTokenPair<'info>,
    /// Authority of the source of the redeemed tokens.
    pub source_authority: Signer<'info>,
    /// Source of the IOU tokens.
    #[account(mut)]
    pub iou_source: Box<Account<'info, TokenAccount>>,
    /// Destination of the IOU tokens.
    #[account(mut)]
    pub redemption_destination: Box<Account<'info, TokenAccount>>,
}

/// Accounts for [redeemer::redeem_tokens_from_mint_proxy].
#[derive(Accounts)]
pub struct RedeemTokensFromMintProxy<'info> {
    /// Redeem tokens.
    pub redeem_ctx: RedeemTokens<'info>,
    /// Mint proxy state.
    #[allow(deprecated)]
    pub mint_proxy_state: CpiState<'info, MintProxy>,
    /// Proxy mint authority.
    /// Owned by the mint proxy.
    pub proxy_mint_authority: UncheckedAccount<'info>,
    /// Mint proxy program.
    pub mint_proxy_program: Program<'info, mint_proxy::program::MintProxy>,
    /// Minter information.
    #[account(mut)]
    pub minter_info: Box<Account<'info, MinterInfo>>,
}

// --------------------------------
// Events
// --------------------------------

/// Emitted when a user redeems tokens.
#[event]
pub struct RedeemTokensEvent {
    /// User redeemed.
    #[index]
    pub user: Pubkey,
    /// Mint of the IOU redeemed.
    pub iou_mint: Pubkey,
    /// Mint of the redemption token.
    pub destination_mint: Pubkey,
    /// Amount redeemed.
    pub amount: u64,
}

/// Errors.
#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized.")]
    Unauthorized,
    #[msg("Redemption token and IOU token decimals must match")]
    DecimalsMismatch,
}

// ?!?
impl From<ErrorCode> for ProgramError { fn from(code: ErrorCode) -> Self { ProgramError::Custom(code.into()) } }