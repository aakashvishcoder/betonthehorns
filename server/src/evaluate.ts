import { type Card, rankOf, suitOf } from "./cards.ts";

export const CATEGORY_NAMES = [
  "High card",
  "Pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
] as const;

export type HandValue = { score: number; name: string };

/** Score = category then up to five kickers, 4 bits each; higher wins. */
const encode = (category: number, kickers: number[]): HandValue => ({
  score: kickers.slice(0, 5).reduce((acc, k) => acc * 16 + k, category) * 16 ** (5 - Math.min(5, kickers.length)),
  name: CATEGORY_NAMES[category]!,
});

/** Highest straight in a set of ranks (5..14), or 0. Ace also plays low. */
function straightHigh(ranks: Set<number>): number {
  for (let high = 14; high >= 5; high--) {
    let run = true;
    for (let r = high; r > high - 5; r--) {
      if (!ranks.has(r === 1 ? 14 : r)) {
        run = false;
        break;
      }
    }
    if (run) return high;
  }
  return 0;
}

/** Best five-card poker hand from 5 to 7 cards. */
export function evaluate(cards: Card[]): HandValue {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const bySuit = new Map<string, number[]>();
  for (const c of cards) bySuit.set(suitOf(c), [...(bySuit.get(suitOf(c)) ?? []), rankOf(c)]);
  const flush = [...bySuit.values()].find(rs => rs.length >= 5)?.sort((a, b) => b - a);

  if (flush) {
    const sf = straightHigh(new Set(flush));
    if (sf) return encode(8, [sf]);
  }

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // Groups ordered by size, then rank: e.g. [[3, K], [2, 9], [1, A], ...]
  const groups = [...counts].map(([rank, n]) => [n, rank] as const).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const kickersExcept = (...used: number[]) => [...new Set(ranks)].filter(r => !used.includes(r));

  const [first, second] = groups;
  if (first![0] === 4) return encode(7, [first![1], ...kickersExcept(first![1]).slice(0, 1)]);
  if (first![0] === 3 && second && second[0] >= 2) return encode(6, [first![1], second[1]]);
  if (flush) return encode(5, flush.slice(0, 5));
  const straight = straightHigh(new Set(ranks));
  if (straight) return encode(4, [straight]);
  if (first![0] === 3) return encode(3, [first![1], ...kickersExcept(first![1]).slice(0, 2)]);
  if (first![0] === 2 && second && second[0] === 2) {
    return encode(2, [first![1], second[1], ...kickersExcept(first![1], second[1]).slice(0, 1)]);
  }
  if (first![0] === 2) return encode(1, [first![1], ...kickersExcept(first![1]).slice(0, 3)]);
  return encode(0, ranks.slice(0, 5));
}
