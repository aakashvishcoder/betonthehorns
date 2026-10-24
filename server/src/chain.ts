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

/** In-memory stand-in for tests and offline runs. Records calls; no Elo math. */
export class MemoryChain implements Chain {
  readonly ratings = new Map<string, number>();
  readonly matches: { id: bigint; mode: Mode; players: string[]; commitment: Uint8Array; settled?: { places: number[]; seed: Uint8Array } }[] = [];

  register(wallet: string, mode: Mode, rating = 1200) {
    this.ratings.set(`${wallet}:${mode}`, rating);
  }

  async rating(wallet: string, mode: Mode) {
    return this.ratings.get(`${wallet}:${mode}`) ?? null;
  }

  async createMatch(mode: Mode, players: string[], seedCommitment: Uint8Array) {
    const id = BigInt(this.matches.length);
    this.matches.push({ id, mode, players, commitment: seedCommitment });
    return id;
  }

  async settleMatch(matchId: bigint, _mode: Mode, _players: string[], places: number[], seed: Uint8Array) {
    this.matches[Number(matchId)]!.settled = { places, seed };
  }
}
