use anchor_lang::prelude::*;

use crate::{
    constants::*,
    state::{GameMode, PlayerRating},
};

#[derive(Accounts)]
#[instruction(mode: GameMode)]
pub struct RegisterPlayer<'info> {
    /// The player's own wallet (e.g. Phantom) signs and pays the account rent.
    #[account(mut)]
    pub wallet: Signer<'info>,
    #[account(
        init,
        payer = wallet,
        space = 8 + PlayerRating::INIT_SPACE,
        seeds = [PLAYER_SEED, wallet.key().as_ref(), mode.seed().as_ref()],
        bump
    )]
    pub player: Account<'info, PlayerRating>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_player(ctx: Context<RegisterPlayer>, mode: GameMode) -> Result<()> {
    ctx.accounts.player.set_inner(PlayerRating {
        wallet: ctx.accounts.wallet.key(),
        mode,
        rating: STARTING_RATING,
        games: 0,
        wins: 0,
        bump: ctx.bumps.player,
    });
    Ok(())
}
