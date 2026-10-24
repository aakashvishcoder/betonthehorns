use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Only the game server key can do this")]
    Unauthorized,
    #[msg("Player count must match the mode: 2, 4 or 6")]
    BadPlayerCount,
    #[msg("A player appears twice in this match")]
    DuplicatePlayer,
    #[msg("This match is already settled")]
    AlreadySettled,
    #[msg("Give one finish place (1 = best) per player")]
    BadPlaces,
    #[msg("Player rating accounts must match the match's players, in order")]
    PlayerAccountMismatch,
    #[msg("Revealed seed does not match the commitment")]
    SeedMismatch,
}
