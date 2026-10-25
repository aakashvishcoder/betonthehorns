import { createHmac } from "node:crypto";

export const RANKS = "23456789TJQKA";
export const SUITS = "cdhs";

/** Two-character card code, e.g. "As" (ace of spades), "Td" (ten of diamonds). */
export type Card = string;

export const FULL_DECK: readonly Card[] = [...SUITS].flatMap(s => [...RANKS].map(r => r + s));

/** 2..14 (ace high). */
export const rankOf = (card: Card) => RANKS.indexOf(card[0]!) + 2;
export const suitOf = (card: Card) => card[1]!;

/**
 * Deterministic deck for one hand of a match: HMAC-SHA256(seed, "hand:counter")
 * feeds a Fisher-Yates shuffle with rejection sampling (no modulo bias).
 * Revealing `seed` after the match lets anyone recompute every deck.
 */
export function shuffledDeck(seed: Uint8Array, hand: number): Card[] {
  let counter = 0;
  let pool = Buffer.alloc(0);
  const nextU32 = () => {
    if (pool.length < 4) {
      pool = createHmac("sha256", seed).update(`${hand}:${counter++}`).digest();
    }
    const value = pool.readUInt32BE(0);
    pool = pool.subarray(4);
    return value;
  };
  const randomBelow = (n: number) => {
    const limit = 2 ** 32 - (2 ** 32 % n);
    for (;;) {
      const v = nextU32();
      if (v < limit) return v % n;
    }
  };

  const deck = [...FULL_DECK];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}
