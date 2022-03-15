//! Manages the minting of new Saber tokens.
#![allow(deprecated)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use anchor_spl::token::{self, Mint, SetAuthority, Token, TokenAccount};
use vipers::prelude::*;

mod proxy_seeds;

declare_id!("UBEBk5idELqykEEaycYtQ7iBVrCg6NmvFSzMpdr22mL");

/// Address of the mint proxy program's state associated account.
pub const PROXY_STATE_ACCOUNT: Pubkey =
    static_pubkey::static_pubkey!("9qRjwMQYrkd5JvsENaYYxSCgwEuVhK4qAo5kCFHSmdmL");

/// Address of the proxy mint authority.
pub const PROXY_MINT_AUTHORITY: Pubkey =
    static_pubkey::static_pubkey!("GyktbGXbH9kvxP8RGfWsnFtuRgC7QCQo2WBqpo3ryk7L");

/// Stub for invoking [mint_proxy::MintProxy::perform_mint].
#[cfg(feature = "cpi")]
pub fn invoke_perform_mint<'a, 'b, 'c, 'info>(
    ctx: CpiContext<'a, 'b, 'c, 'info, crate::cpi::accounts::PerformMint<'info>>,
    mint_proxy_state: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let ix = {
        let ix = crate::instruction::state::PerformMint { amount };
        let data = anchor_lang::InstructionData::data(&ix);
        let mut accounts = ctx.to_account_metas(None);
        accounts.insert(0, AccountMeta::new_readonly(mint_proxy_state.key(), false));
        anchor_lang::solana_program::instruction::Instruction {
            program_id: crate::ID,
            accounts,
            data,
        }
    };
    let mut acc_infos = ctx.to_account_infos();
    acc_infos.insert(0, mint_proxy_state);
    anchor_lang::solana_program::program::invoke_signed(&ix, &acc_infos, ctx.signer_seeds)?;

    Ok(())
}

#[program]
pub mod mint_proxy {
    use super::*;

    #[state]
    pub struct MintProxy {
        /// Nonce for allowing the proxy mint authority to sign.
        pub nonce: u8,
        /// Maximum number of tokens that can be issued.
        pub hard_cap: u64,
        /// Account which is the authority over minted tokens.
        pub proxy_mint_authority: Pubkey,
        /// Owner account which can perform admin operations.
        pub owner: Pubkey,
        /// Next owner account.
        pub pending_owner: Pubkey,
        /// Account key of the state struct.
        pub state_associated_account: Pubkey,
        /// Mint of the token to be minted
        pub token_mint: Pubkey,
    }

    impl MintProxy {
        pub fn new(ctx: Context<Initialize>, nonce: u8, hard_cap: u64) -> Result<Self> {
            require!(
                ctx.accounts.token_mint.freeze_authority.is_none(),
                InvalidFreezeAuthority
            );

            let proxy_signer_seeds = proxy_seeds::gen_signer_seeds(&nonce, &PROXY_STATE_ACCOUNT);
            require!(
                vipers::validate_derived_address(
                    ctx.accounts.proxy_mint_authority.key,
                    ctx.program_id,
                    &proxy_signer_seeds[..],
                ),
                InvalidProxyAuthority
            );

            let proxy_mint_authority = *ctx.accounts.proxy_mint_authority.key;
            let cpi_ctx = new_set_authority_cpi_context(
                &ctx.accounts.mint_authority,
                &ctx.accounts.token_mint.to_account_info(),
                &ctx.accounts.token_program,
            );
            token::set_authority(
                cpi_ctx,
                spl_token::instruction::AuthorityType::MintTokens,
                Some(proxy_mint_authority),
            )?;

            Ok(Self {
                nonce,
                proxy_mint_authority,
                owner: *ctx.accounts.owner.key,
                pending_owner: Pubkey::default(),
                state_associated_account: PROXY_STATE_ACCOUNT,
                token_mint: *ctx.accounts.token_mint.to_account_info().key,
                hard_cap,
            })
        }

        /// Transfers ownership to another account.
        #[access_control(only_owner(self, &ctx.accounts))]
        pub fn transfer_ownership(&mut self, ctx: Context<Auth>, next_owner: Pubkey) -> Result<()> {
            self.pending_owner = next_owner;
            Ok(())
        }

        /// Accepts the new ownership.
        pub fn accept_ownership(&mut self, ctx: Context<Auth>) -> Result<()> {
            require!(ctx.accounts.owner.is_signer, Unauthorized);
            require!(
                self.pending_owner == *ctx.accounts.owner.key,
                PendingOwnerMismatch
            );
            self.owner = self.pending_owner;
            self.pending_owner = Pubkey::default();
            Ok(())
        }

        /// Adds a minter to the mint proxy.
        #[access_control(only_owner(self, &ctx.accounts.auth))]
        pub fn minter_add(&self, ctx: Context<MinterAdd>, allowance: u64) -> Result<()> {
            let minter_info = &mut ctx.accounts.minter_info;
            minter_info.minter = ctx.accounts.minter.key();
            minter_info.allowance = allowance;
            minter_info.__nonce = *unwrap_int!(ctx.bumps.get("minter_info"));
            Ok(())
        }

        /// Updates a mint's allowance.
        #[access_control(only_owner(self, &ctx.accounts.auth))]
        pub fn minter_update(&self, ctx: Context<MinterUpdate>, allowance: u64) -> Result<()> {
            let minter_info = &mut ctx.accounts.minter_info;
            minter_info.allowance = allowance;
            Ok(())
        }

        /// Removes a minter from the list.
        #[access_control(only_owner(self, &ctx.accounts.auth))]
        pub fn minter_remove(&self, ctx: Context<MinterRemove>) -> Result<()> {
            Ok(())
        }

        /// Performs a mint.
        pub fn perform_mint(&self, ctx: Context<PerformMint>, amount: u64) -> Result<()> {
            ctx.accounts.validate(self)?;

            let minter_info = &mut ctx.accounts.minter_info;
            require!(minter_info.allowance >= amount, MinterAllowanceExceeded);

            let new_supply = unwrap_int!(ctx.accounts.token_mint.supply.checked_add(amount),);
            require!(new_supply <= self.hard_cap, HardcapExceeded);

            minter_info.allowance = unwrap_int!(minter_info.allowance.checked_sub(amount));
            let seeds = proxy_seeds::gen_signer_seeds(&self.nonce, &self.state_associated_account);
            let proxy_signer = &[&seeds[..]];
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::MintTo {
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.proxy_mint_authority.to_account_info(),
                },
                proxy_signer,
            );
            token::mint_to(cpi_ctx, amount)?;
            Ok(())
        }

        /// Makes a different account the mint authority.
        #[access_control(only_owner(self, &ctx.accounts.auth))]
        pub fn set_mint_authority(
            &self,
            ctx: Context<SetMintAuthority>,
            new_authority: Pubkey,
        ) -> Result<()> {
            let mut proxy_mint_authority = ctx.accounts.proxy_mint_authority.to_account_info();
            proxy_mint_authority.is_signer = true;

            let seeds = proxy_seeds::gen_signer_seeds(&self.nonce, &self.state_associated_account);
            let proxy_signer = &[&seeds[..]];
            let cpi_ctx = new_set_authority_cpi_context(
                &proxy_mint_authority,
                &ctx.accounts.token_mint.to_account_info(),
                &ctx.accounts.token_program,
            )
            .with_signer(proxy_signer);

            token::set_authority(
                cpi_ctx,
                spl_token::instruction::AuthorityType::MintTokens,
                Some(new_authority),
            )?;

            Ok(())
        }
    }
}

#[derive(Accounts)]
pub struct Auth<'info> {
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Current mint authority.
    pub mint_authority: Signer<'info>,

    /// New mint authority. PDA.
    /// CHECK: Proxy mint authority
    #[account(address = PROXY_MINT_AUTHORITY)]
    pub proxy_mint_authority: UncheckedAccount<'info>,

    /// Owner of the mint proxy.
    /// CHECK: Arbitrary
    pub owner: UncheckedAccount<'info>,

    /// Token mint to mint.
    #[account(mut)]
    pub token_mint: Account<'info, Mint>,

    /// Token program.
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetMintAuthority<'info> {
    pub auth: Auth<'info>,
    /// CHECK: This is actually checked
    #[account(address = PROXY_MINT_AUTHORITY)]
    pub proxy_mint_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub token_mint: Account<'info, Mint>,
    /// The [Token] program.
    pub token_program: Program<'info, Token>,
}

/// Adds a minter.
#[derive(Accounts)]
pub struct MinterAdd<'info> {
    /// Owner of the mint proxy.
    pub auth: Auth<'info>,

    /// Account to authorize as a minter.
    /// CHECK: Arbitrary.
    pub minter: UncheckedAccount<'info>,

    /// Information about the minter.
    #[account(
        init,
        seeds = [
            b"anchor".as_ref(),
            minter.key().as_ref()
        ],
        bump,
        payer = payer
    )]
    pub minter_info: Account<'info, MinterInfo>,

    /// Payer for creating the minter.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Rent sysvar.
    pub rent: Sysvar<'info, Rent>,

    /// System program.
    pub system_program: Program<'info, System>,
}

/// Removes a minter.
#[derive(Accounts)]
pub struct MinterRemove<'info> {
    /// Owner of the mint proxy.
    pub auth: Auth<'info>,

    /// Account to deauthorize as a minter.
    /// CHECK: Arbitrary.
    pub minter: UncheckedAccount<'info>,

    /// Information about the minter.
    #[account(mut, has_one = minter, close = payer)]
    pub minter_info: Account<'info, MinterInfo>,

    /// Account which receives the freed lamports
    /// CHECK: Arbitrary.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,
}

/// Updates a minter.
#[derive(Accounts)]
pub struct MinterUpdate<'info> {
    /// Owner of the mint proxy.
    pub auth: Auth<'info>,
    /// Information about the minter.
    #[account(mut)]
    pub minter_info: Account<'info, MinterInfo>,
}

/// Accounts for the perform_mint instruction.
#[derive(Accounts)]
pub struct PerformMint<'info> {
    /// Mint authority of the proxy.
    /// CHECK: Checked by Vipers.
    pub proxy_mint_authority: UncheckedAccount<'info>,

    /// Minter.
    pub minter: Signer<'info>,

    /// Token mint.
    #[account(mut)]
    pub token_mint: Account<'info, Mint>,

    /// Destination account for minted tokens.
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    /// Minter information.
    #[account(mut, has_one = minter)]
    pub minter_info: Account<'info, MinterInfo>,

    /// SPL Token program.
    pub token_program: Program<'info, Token>,
}

impl<'info> PerformMint<'info> {
    fn validate(&self, state: &MintProxy) -> Result<()> {
        assert_keys_eq!(self.proxy_mint_authority, PROXY_MINT_AUTHORITY);
        require!(self.minter.is_signer, Unauthorized);
        assert_keys_eq!(self.minter_info.minter, self.minter, Unauthorized);

        assert_keys_eq!(state.token_mint, self.token_mint);

        Ok(())
    }
}

/// One who can mint.
#[account]
#[derive(Default)]
pub struct MinterInfo {
    /// Address that can mint.
    pub minter: Pubkey,
    /// Limit of number of tokens that this minter can mint.
    /// Useful for guarded launch.
    pub allowance: u64,
    /// Nonce field to the struct to hold the bump seed for the program derived address,
    /// sourced from `<https://github.com/project-serum/anchor/blob/ec6888a3b9f702bc41bd3266e7dd70116df3549c/lang/attribute/account/src/lib.rs#L220-L221.>`.
    __nonce: u8,
}

/// Ensures the function is only called by the owner of the mint proxy.
fn only_owner(state: &MintProxy, auth: &Auth) -> Result<()> {
    require!(
        auth.owner.is_signer && state.owner == *auth.owner.key,
        Unauthorized
    );
    Ok(())
}

/// Sets the mint authority.
fn new_set_authority_cpi_context<'a, 'b, 'c, 'info>(
    current_authority: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
) -> CpiContext<'a, 'b, 'c, 'info, SetAuthority<'info>> {
    let cpi_accounts = SetAuthority {
        account_or_mint: mint.clone(),
        current_authority: current_authority.clone(),
    };
    let cpi_program = token_program.clone();
    CpiContext::new(cpi_program, cpi_accounts)
}

/// Errors
#[error_code]
pub enum ErrorCode {
    #[msg("You are not authorized to perform this action.")]
    Unauthorized,
    #[msg("Cannot mint over hard cap.")]
    HardcapExceeded,
    #[msg("Provided token mint has a freeze authority")]
    InvalidFreezeAuthority,
    #[msg("Provided token mint was invalid.")]
    InvalidTokenMint,
    #[msg("Provided proxy authority was invalid.")]
    InvalidProxyAuthority,
    #[msg("Not enough remaining accounts in relay context.")]
    NotEnoughAccounts,
    #[msg("Whitelist entry already exists.")]
    WhitelistEntryAlreadyExists,
    #[msg("Whitelist entry not found.")]
    WhitelistEntryNotFound,
    #[msg("Whitelist is full.")]
    WhitelistFull,
    #[msg("Invalid token program ID.")]
    TokenProgramIDMismatch,
    #[msg("Pending owner mismatch.")]
    PendingOwnerMismatch,
    #[msg("Minter allowance exceeded.")]
    MinterAllowanceExceeded,
    #[msg("U64 overflow.")]
    U64Overflow,
}
