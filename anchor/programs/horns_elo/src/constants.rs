use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const PLAYER_SEED: &[u8] = b"player";

#[constant]
pub const MATCH_SEED: &[u8] = b"match";

#[constant]
pub const STARTING_RATING: u32 = 1200;

pub const ELO_K: i64 = 32;

/// Rating gaps beyond this count as this much when computing expected scores.
pub const MAX_RATING_DIFF: i64 = 800;

/// Largest table (six-max).
pub const MAX_PLAYERS: usize = 6;
