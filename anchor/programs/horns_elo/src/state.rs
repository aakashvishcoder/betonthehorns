use anchor_lang::prelude::*;

use crate::constants::MAX_PLAYERS;

/// Ranked Sit & Go modes. Each has its own queue and its own Elo rating.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum GameMode {
    HeadsUp,
    Four,
    Six,
}

impl GameMode {
    pub fn players(self) -> usize {
        match self {
            GameMode::HeadsUp => 2,
            GameMode::Four => 4,
            GameMode::Six => 6,
        }
    }

    /// Seed byte for rating-account addresses.
    pub fn seed(self) -> [u8; 1] {
        [self as u8]
    }
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Game server key: the only signer allowed to create and settle matches.
    pub result_authority: Pubkey,
    pub match_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PlayerRating {
    pub wallet: Pubkey,
    pub mode: GameMode,
    pub rating: u32,
    pub games: u32,
    pub wins: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Match {
    pub id: u64,
    pub mode: GameMode,
    #[max_len(MAX_PLAYERS)]
    pub players: Vec<Pubkey>,
    /// sha256(deck shuffle seed), posted before the deal.
    pub seed_commitment: [u8; 32],
    /// The seed itself, revealed at settlement and checked against the commitment.
    pub revealed_seed: [u8; 32],
    /// sha256 of the final chip counts; the counts themselves stay off-chain.
    pub chip_counts_hash: [u8; 32],
    /// Finish place per player (1 = best), same order as `players`.
    #[max_len(MAX_PLAYERS)]
    pub places: Vec<u8>,
    pub settled: bool,
    pub created_at: i64,
    pub settled_at: i64,
    pub bump: u8,
}
