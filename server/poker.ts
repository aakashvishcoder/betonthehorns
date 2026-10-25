import { randomInt } from "node:crypto";
import { shuffledDeck } from "./src/cards.ts";
import type { Card } from "./types.js";

const SUITS = ["S", "H", "D", "C"] as const;
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

const RANK_CHAR: Record<number, string> = {
  10: "T",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

export function cardCode(card: Card): string {
  return `${RANK_CHAR[card.rank] ?? String(card.rank)}${card.suit}`;
}

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

const SUIT_OF: Record<string, Card["suit"]> = { s: "S", h: "H", d: "D", c: "C" };

/**
 * Provably fair deck for one hand: HMAC-SHA256(seed, hand) drives a Fisher-Yates shuffle.
 * The seed's hash is committed on Solana before the first deal and the seed is revealed when
 * the match ends, so anyone can replay every hand. Cards are dealt by popping from the end.
 */
export function seededDeck(seed: Uint8Array, hand: number): Card[] {
  return shuffledDeck(seed, hand).map((code) => ({
    rank: "23456789TJQKA".indexOf(code[0]!) + 2,
    suit: SUIT_OF[code[1]!]!,
  }));
}

export function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
}

export type HandValue = {
  category: number;
  kickers: number[];
  name: string;
};

function combinations<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i <= items.length - (k - acc.length); i += 1) {
      acc.push(items[i]!);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

function straightHigh(uniqueDesc: number[]): number | null {
  if (uniqueDesc.length < 5) return null;
  for (let i = 0; i <= uniqueDesc.length - 5; i += 1) {
    const slice = uniqueDesc.slice(i, i + 5);
    if (slice[0]! - slice[4]! === 4) return slice[0]!;
  }
  const set = new Set(uniqueDesc);
  if (set.has(14) && set.has(5) && set.has(4) && set.has(3) && set.has(2)) {
    return 5;
  }
  return null;
}

const pluralRank: Record<number, string> = {
  14: "aces",
  13: "kings",
  12: "queens",
  11: "jacks",
  10: "tens",
  9: "nines",
  8: "eights",
  7: "sevens",
  6: "sixes",
  5: "fives",
  4: "fours",
  3: "threes",
  2: "twos",
};

const singularRank: Record<number, string> = {
  14: "Ace",
  13: "King",
  12: "Queen",
  11: "Jack",
  10: "Ten",
  9: "Nine",
  8: "Eight",
  7: "Seven",
  6: "Six",
  5: "Five",
  4: "Four",
  3: "Three",
  2: "Two",
};

function rankFive(cards: Card[]): HandValue {
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const flush = cards.every((card) => card.suit === cards[0]!.suit);
  const unique = [...new Set(ranks)];
  const highStraight = straightHigh(unique);

  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0] - a[0],
  );

  if (flush && highStraight) {
    return {
      category: 8,
      kickers: [highStraight],
      name: highStraight === 14 ? "Royal flush" : `Straight flush, ${singularRank[highStraight] ?? highStraight} high`,
    };
  }
  if (groups[0]?.[1] === 4) {
    const kicker = groups.find((group) => group[1] === 1)?.[0] ?? 0;
    return {
      category: 7,
      kickers: [groups[0][0], kicker],
      name: `Four of a kind, ${pluralRank[groups[0][0]] ?? groups[0][0]}`,
    };
  }
  if (groups[0]?.[1] === 3 && groups[1]?.[1] === 2) {
    return {
      category: 6,
      kickers: [groups[0][0], groups[1][0]],
      name: `Full house, ${pluralRank[groups[0][0]]} over ${pluralRank[groups[1][0]]}`,
    };
  }
  if (flush) {
    return { category: 5, kickers: ranks, name: `Flush, ${singularRank[ranks[0]!] ?? ranks[0]} high` };
  }
  if (highStraight) {
    return {
      category: 4,
      kickers: [highStraight],
      name: `Straight, ${singularRank[highStraight] ?? highStraight} high`,
    };
  }
  if (groups[0]?.[1] === 3) {
    const kickers = groups.filter((group) => group[1] === 1).map((g) => g[0]);
    return {
      category: 3,
      kickers: [groups[0][0], ...kickers],
      name: `Three of a kind, ${pluralRank[groups[0][0]] ?? groups[0][0]}`,
    };
  }
  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) {
    const pairHigh = Math.max(groups[0][0], groups[1][0]);
    const pairLow = Math.min(groups[0][0], groups[1][0]);
    const kicker = groups.find((group) => group[1] === 1)?.[0] ?? 0;
    return {
      category: 2,
      kickers: [pairHigh, pairLow, kicker],
      name: `Two pair, ${pluralRank[pairHigh]} and ${pluralRank[pairLow]}`,
    };
  }
  if (groups[0]?.[1] === 2) {
    const kickers = groups.filter((group) => group[1] === 1).map((g) => g[0]);
    return {
      category: 1,
      kickers: [groups[0][0], ...kickers],
      name: `Pair of ${pluralRank[groups[0][0]] ?? groups[0][0]}`,
    };
  }
  return {
    category: 0,
    kickers: ranks,
    name: `${singularRank[ranks[0]!] ?? ranks[0]} high`,
  };
}

function describeShort(cards: Card[]): HandValue {
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (groups[0]?.[1] === 4) {
    return {
      category: 7,
      kickers: [groups[0][0]],
      name: `Four of a kind, ${pluralRank[groups[0][0]]}`,
    };
  }
  if (groups[0]?.[1] === 3 && groups[1]?.[1] === 2) {
    return {
      category: 6,
      kickers: [groups[0][0], groups[1][0]],
      name: `Full house, ${pluralRank[groups[0][0]]} over ${pluralRank[groups[1][0]]}`,
    };
  }
  if (groups[0]?.[1] === 3) {
    return {
      category: 3,
      kickers: [groups[0][0]],
      name: `Three of a kind, ${pluralRank[groups[0][0]]}`,
    };
  }
  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) {
    const pairHigh = Math.max(groups[0][0], groups[1][0]);
    const pairLow = Math.min(groups[0][0], groups[1][0]);
    return {
      category: 2,
      kickers: [pairHigh, pairLow],
      name: `Two pair, ${pluralRank[pairHigh]} and ${pluralRank[pairLow]}`,
    };
  }
  if (groups[0]?.[1] === 2) {
    return {
      category: 1,
      kickers: [groups[0][0]],
      name: `Pair of ${pluralRank[groups[0][0]]}`,
    };
  }
  return {
    category: 0,
    kickers: ranks,
    name: `${singularRank[ranks[0]!] ?? "High"} high`,
  };
}

export function compareHands(a: HandValue, b: HandValue): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < len; i += 1) {
    const delta = (a.kickers[i] ?? 0) - (b.kickers[i] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

export function evaluate(hole: Card[], board: Card[]): HandValue {
  const cards = [...hole, ...board];
  if (cards.length === 0) {
    return { category: 0, kickers: [], name: "Waiting for cards" };
  }
  if (cards.length < 5) return describeShort(cards);
  let best: HandValue | null = null;
  for (const combo of combinations(cards, 5)) {
    const value = rankFive(combo);
    if (!best || compareHands(value, best) > 0) best = value;
  }
  return best!;
}
