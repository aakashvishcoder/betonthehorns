use anchor_lang::prelude::*;

declare_id!("5edqME6uP35tWd8Wt47UMEND9EzwnTPWcqY7CyGk554F");

const HAND_MILESTONES: [u32; 2] = [1_000, 10_000];
const WIN_MILESTONES: [u32; 6] = [10, 50, 250, 1_250, 6_250, 25_000];

/// Soulbound achievement accounts. Rank badges update in place. Milestone
/// badges are created once the wallet crosses the threshold.
#[program]
pub mod achievements {
    use super::*;

    pub fn sync(
        ctx: Context<Sync>,
        mode: u8,
        elo: u32,
        hands: u32,
        won: bool,
    ) -> Result<()> {
        require!(mode < 3, AchievementError::Mode);
        let owner = ctx.accounts.player.key();
        let authority = ctx.accounts.authority.key();
        let bump = ctx.bumps.record;
        let record = &mut ctx.accounts.record;
        if record.owner == Pubkey::default() {
            record.owner = owner;
            record.authority = authority;
            record.elo = [1200, 1200, 1200];
            record.bump = bump;
        }
        require!(record.authority == authority, AchievementError::Authority);

        let index = mode as usize;
        record.hands = record.hands.saturating_add(hands);
        record.games[index] = record.games[index].saturating_add(1);
        if won {
            record.wins = record.wins.saturating_add(1);
        }
        record.elo[index] = elo;
        record.ranks[index] = rank_tier(elo);

        record.hands_mask = 0;
        for (bit, threshold) in HAND_MILESTONES.iter().enumerate() {
            if record.hands >= *threshold {
                record.hands_mask |= 1 << bit;
            }
        }
        record.wins_mask = 0;
        for (bit, threshold) in WIN_MILESTONES.iter().enumerate() {
            if record.wins >= *threshold {
                record.wins_mask |= 1 << bit;
            }
        }
        Ok(())
    }

    pub fn claim_hands(ctx: Context<ClaimHands>, threshold: u32) -> Result<()> {
        let bit = milestone_bit(&HAND_MILESTONES, threshold)?;
        require!(
            ctx.accounts.record.hands_mask & (1 << bit) != 0,
            AchievementError::Locked
        );
        let owner = ctx.accounts.player.key();
        let bump = ctx.bumps.badge;
        fill_badge(&mut *ctx.accounts.badge, owner, 0, threshold, 255, bump);
        Ok(())
    }

    pub fn claim_wins(ctx: Context<ClaimWins>, threshold: u32) -> Result<()> {
        let bit = milestone_bit(&WIN_MILESTONES, threshold)?;
        require!(
            ctx.accounts.record.wins_mask & (1 << bit) != 0,
            AchievementError::Locked
        );
        let owner = ctx.accounts.player.key();
        let bump = ctx.bumps.badge;
        fill_badge(&mut *ctx.accounts.badge, owner, 1, threshold, 255, bump);
        Ok(())
    }

    pub fn claim_rank(ctx: Context<ClaimRank>, mode: u8) -> Result<()> {
        require!(mode < 3, AchievementError::Mode);
        require!(
            ctx.accounts.record.games[mode as usize] > 0,
            AchievementError::Locked
        );
        let tier = ctx.accounts.record.ranks[mode as usize];
        let owner = ctx.accounts.player.key();
        let bump = ctx.bumps.badge;
        fill_badge(&mut *ctx.accounts.badge, owner, 2, tier as u32, mode, bump);
        Ok(())
    }
}

fn rank_tier(elo: u32) -> u8 {
    if elo <= 1500 {
        1
    } else if elo <= 1800 {
        2
    } else if elo <= 2000 {
        3
    } else if elo <= 2200 {
        4
    } else {
        5
    }
}

fn milestone_bit(thresholds: &[u32], threshold: u32) -> Result<u8> {
    thresholds
        .iter()
        .position(|value| *value == threshold)
        .map(|index| index as u8)
        .ok_or(AchievementError::Threshold.into())
}

fn fill_badge(badge: &mut Badge, owner: Pubkey, kind: u8, threshold: u32, mode: u8, bump: u8) {
    badge.owner = owner;
    badge.kind = kind;
    badge.threshold = threshold;
    badge.mode = mode;
    badge.bump = bump;
}

#[derive(Accounts)]
pub struct Sync<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + 32 + 32 + 4 + 4 + 12 + 12 + 1 + 1 + 3 + 1,
        seeds = [b"record", player.key().as_ref()],
        bump
    )]
    pub record: Account<'info, Record>,
    /// CHECK: Wallet whose achievements are updated. The PDA binds the key.
    pub player: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(threshold: u32)]
pub struct ClaimHands<'info> {
    #[account(
        seeds = [b"record", player.key().as_ref()],
        bump = record.bump,
        constraint = record.owner == player.key()
    )]
    pub record: Account<'info, Record>,
    #[account(
        init,
        payer = player,
        space = 8 + 32 + 1 + 4 + 1 + 1,
        seeds = [b"hands", player.key().as_ref(), &threshold.to_le_bytes()],
        bump
    )]
    pub badge: Account<'info, Badge>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(threshold: u32)]
pub struct ClaimWins<'info> {
    #[account(
        seeds = [b"record", player.key().as_ref()],
        bump = record.bump,
        constraint = record.owner == player.key()
    )]
    pub record: Account<'info, Record>,
    #[account(
        init,
        payer = player,
        space = 8 + 32 + 1 + 4 + 1 + 1,
        seeds = [b"wins", player.key().as_ref(), &threshold.to_le_bytes()],
        bump
    )]
    pub badge: Account<'info, Badge>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(mode: u8)]
pub struct ClaimRank<'info> {
    #[account(
        seeds = [b"record", player.key().as_ref()],
        bump = record.bump,
        constraint = record.owner == player.key()
    )]
    pub record: Account<'info, Record>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + 32 + 1 + 4 + 1 + 1,
        seeds = [b"rank", player.key().as_ref(), &[mode]],
        bump
    )]
    pub badge: Account<'info, Badge>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Record {
    pub owner: Pubkey,
    pub authority: Pubkey,
    pub hands: u32,
    pub wins: u32,
    pub elo: [u32; 3],
    pub games: [u32; 3],
    pub hands_mask: u8,
    pub wins_mask: u8,
    pub ranks: [u8; 3],
    pub bump: u8,
}

#[account]
pub struct Badge {
    pub owner: Pubkey,
    pub kind: u8,
    pub threshold: u32,
    pub mode: u8,
    pub bump: u8,
}

#[error_code]
pub enum AchievementError {
    #[msg("Mode must be 0, 1, or 2")]
    Mode,
    #[msg("Signer is not the achievement authority")]
    Authority,
    #[msg("That milestone is not part of this program")]
    Threshold,
    #[msg("This wallet has not reached that dNFT yet")]
    Locked,
}
