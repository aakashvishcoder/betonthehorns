pub mod constants;
pub mod elo;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("E4WuDUxqymTCF7rqQz4a4ZmVhWuQJe9Pbrmy7uia5Bbo");

#[program]
pub mod horns_elo {
    use super::*;

    /// One-time setup: records the admin and the game server key.
    pub fn initialize(ctx: Context<Initialize>, result_authority: Pubkey) -> Result<()> {
        crate::instructions::initialize::handle_initialize(ctx, result_authority)
    }

    /// A player's wallet creates its rating account at 1200.
    pub fn register_player(ctx: Context<RegisterPlayer>) -> Result<()> {
        crate::instructions::register_player::handle_register_player(ctx)
    }

    /// Game server opens a match and commits to the shuffle seed before the deal.
    pub fn create_match(
        ctx: Context<CreateMatch>,
        players: Vec<Pubkey>,
        seed_commitment: [u8; 32],
    ) -> Result<()> {
        crate::instructions::create_match::handle_create_match(ctx, players, seed_commitment)
    }

    /// Game server reveals the seed, records final places and updates Elo.
    pub fn settle_match<'info>(
        ctx: Context<'info, SettleMatch<'info>>,
        places: Vec<u8>,
        revealed_seed: [u8; 32],
        chip_counts_hash: [u8; 32],
    ) -> Result<()> {
        crate::instructions::settle_match::handle_settle_match(
            ctx,
            places,
            revealed_seed,
            chip_counts_hash,
        )
    }
}
