use crate::MutTokenPair;
use crate::Redeemer;
use anchor_lang::prelude::*;
use anchor_spl::token;
use vipers::assert_keys_eq;

impl<'info> MutTokenPair<'info> {
    /// Transfer tokens from source account to the redeemer's vault.
    pub fn burn_iou_tokens(
        &self,
        source_account: AccountInfo<'info>,
        source_authority: AccountInfo<'info>,
        amount: u64,
    ) -> Result<()> {
        let cpi_accounts = token::Burn {
            mint: self.iou_mint.to_account_info(),
            to: source_account,
            authority: source_authority,
        };
        let cpi_ctx = CpiContext::new(self.token_program.to_account_info(), cpi_accounts);
        token::burn(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn validate_token_accounts(&self, redeemer: &Account<Redeemer>) -> Result<()> {
        assert_keys_eq!(self.iou_mint, redeemer.iou_mint, "iou_mint");
        assert_keys_eq!(
            self.redemption_mint,
            redeemer.redemption_mint,
            "redemption_mint"
        );
        assert_keys_eq!(self.redemption_vault, redeemer.redemption_vault);

        Ok(())
    }
}
