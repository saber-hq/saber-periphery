use crate::{
    CreateRedeemer, MutTokenPair, ReadonlyTokenPair, RedeemTokens, RedeemTokensFromMintProxy,
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use vipers::validate::Validate;
use vipers::{assert_ata, assert_keys_eq, assert_owner};

impl<'info> Validate<'info> for CreateRedeemer<'info> {
    fn validate(&self) -> ProgramResult {
        self.tokens.validate()?;

        assert_ata!(
            self.tokens.redemption_vault,
            self.redeemer,
            self.tokens.redemption_mint
        );

        Ok(())
    }
}

impl<'info> Validate<'info> for RedeemTokens<'info> {
    fn validate(&self) -> ProgramResult {
        self.tokens.validate()?;
        self.tokens.validate_token_accounts(&self.redeemer)?;

        assert_keys_eq!(
            self.iou_source.mint,
            self.redeemer.iou_mint,
            "iou_source.mint"
        );

        require!(self.source_authority.is_signer, Unauthorized);
        assert_keys_eq!(
            self.source_authority,
            self.redemption_destination.owner,
            "redemption_destination.owner"
        );

        Ok(())
    }
}

impl<'info> Validate<'info> for RedeemTokensFromMintProxy<'info> {
    fn validate(&self) -> ProgramResult {
        self.redeem_ctx.validate()?;

        assert_keys_eq!(
            self.minter_info.minter,
            self.redeem_ctx.redeemer,
            "minter_info.minter"
        );
        assert_keys_eq!(
            self.mint_proxy_state.token_mint,
            self.redeem_ctx.redeemer.redemption_mint,
            "redemption_mint"
        );

        assert_keys_eq!(self.mint_proxy_program, mint_proxy::ID);
        assert_keys_eq!(
            self.proxy_mint_authority,
            self.mint_proxy_state.proxy_mint_authority,
            "proxy_mint_authority"
        );

        assert_owner!(self.mint_proxy_state, mint_proxy::ID);

        Ok(())
    }
}

impl<'info> Validate<'info> for ReadonlyTokenPair<'info> {
    fn validate(&self) -> ProgramResult {
        require!(
            self.iou_mint.decimals == self.redemption_mint.decimals,
            DecimalsMismatch
        );
        assert_keys_eq!(self.redemption_vault.mint, self.redemption_mint);

        assert_owner!(self.iou_mint, token::ID);
        assert_owner!(self.redemption_mint, token::ID);
        assert_owner!(self.redemption_vault, token::ID);

        Ok(())
    }
}

impl<'info> Validate<'info> for MutTokenPair<'info> {
    fn validate(&self) -> ProgramResult {
        assert_keys_eq!(self.redemption_vault.mint, self.redemption_mint);

        assert_owner!(self.iou_mint, token::ID);
        assert_owner!(self.redemption_mint, token::ID);
        assert_owner!(self.redemption_vault, token::ID);

        Ok(())
    }
}
