use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Config, GameMode, Match},
};

#[derive(Accounts)]
pub struct CreateMatch<'info> {
    #[account(mut)]
    pub result_authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = result_authority @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = result_authority,
        space = 8 + Match::INIT_SPACE,
        seeds = [MATCH_SEED, config.match_count.to_le_bytes().as_ref()],
        bump
    )]
    pub game: Account<'info, Match>,
    pub system_program: Program<'info, System>,
}

/// Opens a match before the deal, committing to the shuffle seed so the
/// deck can be proven fair once the seed is revealed at settlement.
pub fn handle_create_match(
    ctx: Context<CreateMatch>,
    mode: GameMode,
    players: Vec<Pubkey>,
    seed_commitment: [u8; 32],
) -> Result<()> {
    require!(players.len() == mode.players(), ErrorCode::BadPlayerCount);
    for (i, player) in players.iter().enumerate() {
        require!(!players[..i].contains(player), ErrorCode::DuplicatePlayer);
    }

    let config = &mut ctx.accounts.config;
    ctx.accounts.game.set_inner(Match {
        id: config.match_count,
        mode,
        places: vec![0; players.len()],
        players,
        seed_commitment,
        revealed_seed: [0; 32],
        chip_counts_hash: [0; 32],
        settled: false,
        created_at: Clock::get()?.unix_timestamp,
        settled_at: 0,
        bump: ctx.bumps.game,
    });
    config.match_count += 1;
    Ok(())
}
