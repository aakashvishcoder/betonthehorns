import { createHash } from "node:crypto";
import { STARTING_RATING, ratingDeltas } from "./elo.ts";
import type { Mode } from "./matchmaker.ts";

/** What the game server needs from the horns_elo program. */
export interface Chain {
  /** The wallet's Elo for a mode, or null if it hasn't called register_player for it. */
  rating(wallet: string, mode: Mode): Promise<number | null>;
  /** Opens the match on-chain, committing to sha256(seed). Returns the match id. */
  createMatch(mode: Mode, players: string[], seedCommitment: Uint8Array): Promise<bigint>;
  /** Reveals the seed and records places; the program updates Elo. */
  settleMatch(matchId: bigint, mode: Mode, players: string[], places: number[], seed: Uint8Array, standingsHash: Uint8Array): Promise<void>;
}

export type RatingRecord = { wallet: string; mode: Mode; rating: number; games: number; wins: number };

/**
 * In-memory stand-in for the horns_elo program, for tests and the offline prototype.
 * Mirrors the program: seed must match its commitment, a match settles once, Elo updates per mode.
 */
export class MemoryChain implements Chain {
  readonly records = new Map<string, RatingRecord>();
  readonly matches: {
    id: bigint;
    mode: Mode;
    players: string[];
    commitment: Uint8Array;
    settled?: { places: number[]; seed: Uint8Array; standingsHash: Uint8Array };
  }[] = [];
  private readonly autoRegister: boolean;

  /** `autoRegister`: unknown wallets start at 1200 instead of being refused (prototype mode). */
  constructor(options: { autoRegister?: boolean } = {}) {
    this.autoRegister = options.autoRegister ?? false;
  }

  register(wallet: string, mode: Mode, rating = STARTING_RATING) {
    this.records.set(`${wallet}:${mode}`, { wallet, mode, rating, games: 0, wins: 0 });
  }

  async rating(wallet: string, mode: Mode) {
    if (this.autoRegister && !this.records.has(`${wallet}:${mode}`)) this.register(wallet, mode);
    return this.records.get(`${wallet}:${mode}`)?.rating ?? null;
  }

  async createMatch(mode: Mode, players: string[], seedCommitment: Uint8Array) {
    const id = BigInt(this.matches.length);
    this.matches.push({ id, mode, players, commitment: seedCommitment });
    return id;
  }

  async settleMatch(matchId: bigint, mode: Mode, players: string[], places: number[], seed: Uint8Array, standingsHash: Uint8Array) {
    const match = this.matches[Number(matchId)];
    if (!match) throw new Error("no such match");
    if (match.settled) throw new Error("This match is already settled");
    if (!createHash("sha256").update(seed).digest().equals(Buffer.from(match.commitment))) {
      throw new Error("Revealed seed does not match the commitment");
    }
    const records = players.map(p => this.records.get(`${p}:${mode}`)!);
    const deltas = ratingDeltas(records.map(r => r.rating), places);
    records.forEach((r, i) => {
      r.rating = Math.max(0, r.rating + deltas[i]!);
      r.games++;
      if (places[i] === 1) r.wins++;
    });
    match.settled = { places, seed, standingsHash };
  }
}
