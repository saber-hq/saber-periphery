use crate::*;

use vipers::validate::Validate;
use vipers::{assert_keys_eq, invariant};

impl<'info> Validate<'info> for CreateRedeemer<'info> {
    fn validate(&self) -> Result<()> {
        self.tokens.validate()?;

        assert_keys_eq!(self.tokens.redemption_vault.owner, self.redeemer);
        assert_keys_eq!(
            self.tokens.redemption_vault.mint,
            self.tokens.redemption_mint
        );
        invariant!(self.tokens.redemption_vault.delegate.is_none());
        invariant!(self.tokens.redemption_vault.close_authority.is_none());

        Ok(())
    }
}

impl<'info> Validate<'info> for RedeemTokens<'info> {
    fn validate(&self) -> Result<()> {
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
    fn validate(&self) -> Result<()> {
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

        assert_keys_eq!(
            self.proxy_mint_authority,
            self.mint_proxy_state.proxy_mint_authority,
            "proxy_mint_authority"
        );

        Ok(())
    }
}

impl<'info> Validate<'info> for ReadonlyTokenPair<'info> {
    fn validate(&self) -> Result<()> {
        require!(
            self.iou_mint.decimals == self.redemption_mint.decimals,
            DecimalsMismatch
        );
        assert_keys_eq!(self.redemption_vault.mint, self.redemption_mint);

        Ok(())
    }
}

impl<'info> Validate<'info> for MutTokenPair<'info> {
    fn validate(&self) -> Result<()> {
        assert_keys_eq!(self.redemption_vault.mint, self.redemption_mint);

        Ok(())
    }
}
