import type { GameMode } from "./types.js";

export const STARTING_ELO = 1200;
/** Elo sensitivity. A result this far from the expectation moves the rating by this many points. */
export const K_FACTOR = 32;

export const HAND_MILESTONES = [1_000, 10_000] as const;
export const WIN_MILESTONES = [10, 50, 250, 1_250, 6_250, 25_000] as const;

export type RankName = "Bronze" | "Silver" | "Gold" | "Diamond" | "Platinum";

/** Current rank from the ceiling of each band. Above 2300 stays Platinum. */
export function rankFromElo(elo: number): RankName {
  if (elo <= 1500) return "Bronze";
  if (elo <= 1800) return "Silver";
  if (elo <= 2000) return "Gold";
  if (elo <= 2200) return "Diamond";
  return "Platinum";
}

export type RatedPlayer = {
  walletId: string;
  elo: number;
};

export type PlacedPlayer = RatedPlayer & {
  /** 1 is the best finish. Tied stacks share a place. */
  place: number;
  /** ELO already locked for this player. */
  stake: number;
};

/** Chance that `elo` finishes ahead of `opponent`, on the standard 400-point scale. */
export function expectedScore(elo: number, opponent: number) {
  return 1 / (1 + 10 ** ((opponent - elo) / 400));
}

/**
 * ELO locked at the table. It is the most that seat can lose against this
 * exact field, so a favorite locks more than an underdog.
 */
export function escrowAtRisk(players: RatedPlayer[]) {
  const count = players.length;
  return players.map((player) => {
    if (count < 2) return { walletId: player.walletId, stake: 0 };
    let worst = 0;
    for (const other of players) {
      if (other.walletId === player.walletId) continue;
      worst += (K_FACTOR * (0 - expectedScore(player.elo, other.elo))) / (count - 1);
    }
    const theoretical = Math.max(0, Math.round(-worst));
    const stake = Math.min(Math.max(0, Math.floor(player.elo)), theoretical);
    return { walletId: player.walletId, stake };
  });
}

export type EloResult = {
  walletId: string;
  before: number;
  delta: number;
  after: number;
  stake: number;
  /** Returned from escrow. Equals stake + delta, and never goes below 0. */
  payout: number;
  place: number;
};

/**
 * Zero-sum multiplayer ELO. Beating a higher rating is worth more than
 * beating a lower one. Each pair is weighted by 1/(n-1) so a full table
 * moves about as much as a heads-up match.
 */
export function settleRatings(players: PlacedPlayer[]): EloResult[] {
  const count = players.length;
  const raw = players.map((player) => {
    if (count < 2) return 0;
    let delta = 0;
    for (const other of players) {
      if (other.walletId === player.walletId) continue;
      const expected = expectedScore(player.elo, other.elo);
      const score =
        player.place < other.place ? 1 : player.place === other.place ? 0.5 : 0;
      delta += (K_FACTOR * (score - expected)) / (count - 1);
    }
    return delta;
  });

  const rounded = raw.map((delta) => Math.round(delta));
  const drift = rounded.reduce((sum, delta) => sum + delta, 0);
  if (drift !== 0) {
    const best = Math.min(...players.map((player) => player.place));
    const winner = players.findIndex((player) => player.place === best);
    rounded[winner] = (rounded[winner] ?? 0) - drift;
  }

  const fitted = fitToEscrow(rounded, players.map((player) => player.stake));
  return players.map((player, index) => {
    const delta = fitted[index] ?? 0;
    const after = Math.max(0, player.elo + delta);
    const applied = after - player.elo;
    return {
      walletId: player.walletId,
      before: player.elo,
      delta: applied,
      after,
      stake: player.stake,
      payout: player.stake + applied,
      place: player.place,
    };
  });
}

/** Losses cannot exceed the ELO that was locked. Gains shrink by the same amount. */
function fitToEscrow(deltas: number[], stakes: number[]) {
  const next = deltas.map((delta, index) => Math.max(delta, -(stakes[index] ?? 0)));
  let excess = next.reduce((sum, delta) => sum + delta, 0);
  if (excess <= 0) return next;

  const gainers = next
    .map((delta, index) => ({ index, delta }))
    .filter((row) => row.delta > 0);
  const total = gainers.reduce((sum, row) => sum + row.delta, 0);
  if (total <= 0) return next;

  let removed = 0;
  for (const row of gainers) {
    const cut = Math.min(next[row.index] ?? 0, Math.floor((excess * row.delta) / total));
    next[row.index] = (next[row.index] ?? 0) - cut;
    removed += cut;
  }
  let leftover = excess - removed;
  const ordered = [...gainers].sort((a, b) => (next[b.index] ?? 0) - (next[a.index] ?? 0));
  for (const row of ordered) {
    if (leftover <= 0) break;
    const room = next[row.index] ?? 0;
    const take = Math.min(room, leftover);
    next[row.index] = room - take;
    leftover -= take;
  }
  return next;
}

export function modeIndex(mode: GameMode) {
  if (mode === "hands-up") return 0;
  if (mode === "sng-4") return 1;
  return 2;
}
