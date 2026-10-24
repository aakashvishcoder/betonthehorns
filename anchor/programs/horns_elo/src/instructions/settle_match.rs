use anchor_lang::prelude::*;
use solana_sha256_hasher::hash;

use crate::{
    constants::*,
    elo::rating_deltas,
    error::ErrorCode,
    state::{Config, Match, PlayerRating},
};

#[derive(Accounts)]
pub struct SettleMatch<'info> {
    pub result_authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = result_authority @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [MATCH_SEED, game.id.to_le_bytes().as_ref()],
        bump = game.bump
    )]
    pub game: Account<'info, Match>,
    // remaining_accounts: one writable PlayerRating per player, in `game.players` order.
}

pub fn handle_settle_match<'info>(
    ctx: Context<'info, SettleMatch<'info>>,
    places: Vec<u8>,
    revealed_seed: [u8; 32],
    chip_counts_hash: [u8; 32],
) -> Result<()> {
    let game = &mut ctx.accounts.game;
    require!(!game.settled, ErrorCode::AlreadySettled);
    require!(
        places.len() == game.players.len()
            && places.iter().all(|&p| p >= 1 && p as usize <= places.len()),
        ErrorCode::BadPlaces
    );
    require!(
        hash(&revealed_seed).to_bytes() == game.seed_commitment,
        ErrorCode::SeedMismatch
    );
    require!(
        ctx.remaining_accounts.len() == game.players.len(),
        ErrorCode::PlayerAccountMismatch
    );

    let mut ratings = Vec::with_capacity(game.players.len());
    for (info, wallet) in ctx.remaining_accounts.iter().zip(&game.players) {
        let (expected, _) =
            Pubkey::find_program_address(&[PLAYER_SEED, wallet.as_ref()], &crate::ID);
        require_keys_eq!(info.key(), expected, ErrorCode::PlayerAccountMismatch);
        ratings.push(Account::<PlayerRating>::try_from(info)?);
    }

    let current: Vec<u32> = ratings.iter().map(|p| p.rating).collect();
    let deltas = rating_deltas(&current, &places);
    for ((player, delta), place) in ratings.iter_mut().zip(deltas).zip(&places) {
        player.rating = (player.rating as i64 + delta).max(0) as u32;
        player.games += 1;
        if *place == 1 {
            player.wins += 1;
        }
        player.exit(&crate::ID)?;
    }

    game.places = places;
    game.revealed_seed = revealed_seed;
    game.chip_counts_hash = chip_counts_hash;
    game.settled = true;
    game.settled_at = Clock::get()?.unix_timestamp;
    Ok(())
}
