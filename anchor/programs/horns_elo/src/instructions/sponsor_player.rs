use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Config, GameMode, PlayerRating},
};

/// The game server creates (and pays rent for) a player's rating account, so players
/// never need SOL or a wallet transaction to start playing ranked.
#[derive(Accounts)]
#[instruction(wallet: Pubkey, mode: GameMode)]
pub struct SponsorPlayer<'info> {
    #[account(mut)]
    pub result_authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = result_authority @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = result_authority,
        space = 8 + PlayerRating::INIT_SPACE,
        seeds = [PLAYER_SEED, wallet.as_ref(), mode.seed().as_ref()],
        bump
    )]
    pub player: Account<'info, PlayerRating>,
    pub system_program: Program<'info, System>,
}

pub fn handle_sponsor_player(ctx: Context<SponsorPlayer>, wallet: Pubkey, mode: GameMode) -> Result<()> {
    ctx.accounts.player.set_inner(PlayerRating {
        wallet,
        mode,
        rating: STARTING_RATING,
        games: 0,
        wins: 0,
        bump: ctx.bumps.player,
    });
    Ok(())
}
