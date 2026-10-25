use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;

declare_id!("9KXCrZkohvdxYUvKU9kusUcBCdj1JB1NFUoYgFbdnWS2");

pub const STARTING_ELO: u32 = 1200;

/// Opening a match locks each player's stake into the escrow.
/// Settlement pays that pot out from the poker result. The backend chooses
/// the payouts; they must add up to exactly what was locked.
#[program]
pub mod elo_escrow {
    use super::*;

    pub fn initialize_rating(ctx: Context<InitializeRating>, mode: u8) -> Result<()> {
        require!(mode < 3, EloError::Mode);
        let rating = &mut ctx.accounts.rating;
        rating.player = ctx.accounts.player.key();
        rating.mode = mode;
        rating.elo = STARTING_ELO;
        rating.bump = ctx.bumps.rating;
        Ok(())
    }

    pub fn open_escrow(
        ctx: Context<OpenEscrow>,
        match_hash: [u8; 32],
        mode: u8,
        commit_hash: [u8; 32],
        stakes: Vec<u32>,
    ) -> Result<()> {
        require!(mode < 3, EloError::Mode);
        let seats = ctx.remaining_accounts.len();
        require!(seats >= 2 && seats <= 6, EloError::Players);
        require!(stakes.len() == seats, EloError::Players);

        let mut locked: u32 = 0;
        for (stake, account) in stakes.iter().zip(ctx.remaining_accounts.iter()) {
            require!(account.owner == ctx.program_id, EloError::Rating);
            let mut data = account.try_borrow_mut_data()?;
            require!(data.len() >= 46, EloError::Rating);
            let player: [u8; 32] = data[8..40].try_into().unwrap();
            require!(data[40] == mode, EloError::Mode);
            let (pda, _) =
                Pubkey::find_program_address(&[b"rating", &player, &[mode]], ctx.program_id);
            require!(account.key() == pda, EloError::Rating);
            let elo = u32::from_le_bytes(data[41..45].try_into().unwrap());
            require!(elo >= *stake, EloError::Insufficient);
            data[41..45].copy_from_slice(&(elo - *stake).to_le_bytes());
            locked = locked.checked_add(*stake).ok_or(EloError::Stake)?;
        }

        let escrow = &mut ctx.accounts.escrow;
        escrow.match_hash = match_hash;
        escrow.mode = mode;
        escrow.commit_hash = commit_hash;
        escrow.seed = [0; 32];
        escrow.settled = false;
        escrow.authority = ctx.accounts.authority.key();
        escrow.bump = ctx.bumps.escrow;
        escrow.stake = 0;
        escrow.locked = locked;
        Ok(())
    }

    /// Reveals the shuffle seed and pays the locked pot out to the seats.
    pub fn settle(ctx: Context<Settle>, seed: [u8; 32], payouts: Vec<u32>) -> Result<()> {
        require!(!ctx.accounts.escrow.settled, EloError::Settled);
        require!(
            hash(&seed).to_bytes() == ctx.accounts.escrow.commit_hash,
            EloError::Commit
        );
        require!(payouts.len() >= 2 && payouts.len() <= 6, EloError::Players);
        require!(
            payouts.len() == ctx.remaining_accounts.len(),
            EloError::Players
        );
        let sum: u64 = payouts.iter().map(|payout| *payout as u64).sum();
        require!(sum == ctx.accounts.escrow.locked as u64, EloError::Pot);

        let mode = ctx.accounts.escrow.mode;
        for (payout, account) in payouts.iter().zip(ctx.remaining_accounts.iter()) {
            require!(account.owner == ctx.program_id, EloError::Rating);
            let mut data = account.try_borrow_mut_data()?;
            require!(data.len() >= 46, EloError::Rating);
            let player: [u8; 32] = data[8..40].try_into().unwrap();
            require!(data[40] == mode, EloError::Mode);
            let (pda, _) =
                Pubkey::find_program_address(&[b"rating", &player, &[mode]], ctx.program_id);
            require!(account.key() == pda, EloError::Rating);
            let elo = u32::from_le_bytes(data[41..45].try_into().unwrap());
            let next = elo.checked_add(*payout).ok_or(EloError::Stake)?;
            data[41..45].copy_from_slice(&next.to_le_bytes());
        }

        let escrow = &mut ctx.accounts.escrow;
        escrow.seed = seed;
        escrow.settled = true;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(mode: u8)]
pub struct InitializeRating<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 1 + 4 + 1,
        seeds = [b"rating", player.key().as_ref(), &[mode]],
        bump
    )]
    pub rating: Account<'info, Rating>,
    /// CHECK: The wallet this rating belongs to. The PDA binds the key.
    pub player: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(match_hash: [u8; 32])]
pub struct OpenEscrow<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 1 + 32 + 32 + 1 + 32 + 1 + 4 + 4,
        seeds = [b"escrow", match_hash.as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut, has_one = authority)]
    pub escrow: Account<'info, Escrow>,
    pub authority: Signer<'info>,
}

#[account]
pub struct Rating {
    pub player: Pubkey,
    pub mode: u8,
    pub elo: u32,
    pub bump: u8,
}

#[account]
pub struct Escrow {
    pub match_hash: [u8; 32],
    pub mode: u8,
    pub commit_hash: [u8; 32],
    pub seed: [u8; 32],
    pub settled: bool,
    pub authority: Pubkey,
    pub bump: u8,
    pub stake: u32,
    /// Total ELO moved out of the ratings when the table opened.
    pub locked: u32,
}

#[error_code]
pub enum EloError {
    #[msg("Mode must be 0, 1, or 2")]
    Mode,
    #[msg("This escrow is already settled")]
    Settled,
    #[msg("Signer is not the escrow authority")]
    Authority,
    #[msg("Revealed seed does not match the commitment")]
    Commit,
    #[msg("Stake must be greater than zero")]
    Stake,
    #[msg("Rating does not have enough ELO to lock")]
    Insufficient,
    #[msg("Payouts must equal the ELO locked in escrow")]
    Pot,
    #[msg("Rating accounts do not match the settlement")]
    Players,
    #[msg("Rating account is not the expected PDA")]
    Rating,
}
