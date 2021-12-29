use anchor_lang::solana_program::pubkey::Pubkey;

pub fn gen_signer_seeds<'a>(nonce: &'a u8, state_associated_account: &'a Pubkey) -> [&'a [u8]; 3] {
    [
        b"SaberMintProxy",
        state_associated_account.as_ref(),
        bytemuck::bytes_of(nonce),
    ]
}
