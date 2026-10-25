import { createHash } from "node:crypto";
import { FULL_DECK, RANKS, rankOf, suitOf, type Card } from "./src/cards.ts";
import { evaluate } from "./src/evaluate.ts";

/**
 * Daily poker puzzles with provable answers. Every spot states its assumptions (what the
 * opponent holds or calls with, and that no more betting follows), so the right answer is pure
 * math: exact equity over every river card, or a seeded 20,000-run simulation, compared with
 * pot odds / expected value. Spots within a safety margin of break-even are thrown out, so no
 * answer is a coin flip. The same date always gives the same five puzzles for everyone.
 */

export type Choice = "fold" | "call" | "shove";
export type PuzzleKind = "draw" | "shove" | "defend";

/** What the browser sees before answering: no answer, no numbers. */
export type PuzzleView = {
  id: string;
  day: string;
  index: number;
  kind: PuzzleKind;
  difficulty: "easy" | "medium" | "hard";
  title: string;
  street: "preflop" | "turn";
  /** Two-character codes with uppercase suits, matching /cards/deck (e.g. "AS", "TD"). */
  hero: string[];
  board: string[];
  position: string;
  situation: string;
  assumption: string;
  pot: number;
  toCall: number;
  bigBlind: number;
  heroStack: number;
  options: { id: Choice; label: string }[];
};

export type PuzzleAnswer = {
  answer: Choice;
  /** Why, with the numbers. */
  explanation: string;
  numbers: { label: string; value: string }[];
};

export type Puzzle = PuzzleView & { solution: PuzzleAnswer };

// ---- Deterministic randomness per day ----

function rngFrom(seed: string) {
  const h = createHash("sha256").update(seed).digest();
  let a = h.readUInt32LE(0), b = h.readUInt32LE(4), c = h.readUInt32LE(8), d = h.readUInt32LE(12);
  // sfc32
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
}

const pick = <T>(xs: readonly T[], random: () => number) => xs[Math.floor(random() * xs.length)]!;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const bb = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)} bb`;
export const toDeckCode = (c: Card) => `${c[0]}${c[1]!.toUpperCase()}`;

// ---- Preflop ranges: hands ordered by the Chen formula ----

const CHEN_HIGH: Record<number, number> = { 14: 10, 13: 8, 12: 7, 11: 6 };

/** Chen formula score for a starting hand (higher is better). */
export function chen(r1: number, r2: number, suited: boolean) {
  const [hi, lo] = r1 >= r2 ? [r1, r2] : [r2, r1];
  let score = CHEN_HIGH[hi] ?? hi / 2;
  if (hi === lo) return Math.max(5, score * 2);
  if (suited) score += 2;
  const gap = hi - lo - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && hi < 12) score += 1;
  return Math.ceil(score);
}

/** The 169 starting-hand classes, best first: "AA", "AKs", "AKo", ... */
export const HAND_CLASSES: string[] = (() => {
  const classes: { name: string; score: number; hi: number; lo: number; suited: boolean }[] = [];
  for (let i = 12; i >= 0; i--) {
    for (let j = i; j >= 0; j--) {
      const hi = i + 2, lo = j + 2;
      if (hi === lo) classes.push({ name: RANKS[i]! + RANKS[j]!, score: chen(hi, lo, false), hi, lo, suited: false });
      else {
        classes.push({ name: `${RANKS[i]}${RANKS[j]}s`, score: chen(hi, lo, true), hi, lo, suited: true });
        classes.push({ name: `${RANKS[i]}${RANKS[j]}o`, score: chen(hi, lo, false), hi, lo, suited: false });
      }
    }
  }
  return classes
    .sort((a, b) => b.score - a.score || b.hi - a.hi || b.lo - a.lo || Number(b.suited) - Number(a.suited))
    .map((c) => c.name);
})();

const combosOf = (cls: string): [Card, Card][] => {
  const r1 = cls[0]!, r2 = cls[1]!, kind = cls[2];
  const out: [Card, Card][] = [];
  for (const s1 of "cdhs") for (const s2 of "cdhs") {
    if (r1 === r2 ? s1 >= s2 : kind === "s" ? s1 !== s2 : s1 === s2) continue;
    out.push([r1 + s1, r2 + s2]);
  }
  return out;
};

/** Every combo in the top `fraction` of hands (by combos), minus cards already seen. */
export function topRange(fraction: number, dead: Card[]): [Card, Card][] {
  const deadSet = new Set(dead);
  const target = fraction * 1326;
  const range: [Card, Card][] = [];
  let counted = 0;
  for (const cls of HAND_CLASSES) {
    if (counted >= target) break;
    const combos = combosOf(cls);
    counted += combos.length;
    range.push(...combos.filter(([a, b]) => !deadSet.has(a) && !deadSet.has(b)));
  }
  return range;
}

// ---- Equity ----

/** Exact equity of `hero` vs a range on the turn: every villain combo x every river card. */
export function turnEquityExact(hero: Card[], board: Card[], villain: [Card, Card][]) {
  let score = 0, total = 0;
  for (const [v1, v2] of villain) {
    const used = new Set([...hero, ...board, v1, v2]);
    for (const river of FULL_DECK) {
      if (used.has(river)) continue;
      const full = [...board, river];
      const h = evaluate([...hero, ...full]).score;
      const v = evaluate([v1, v2, ...full]).score;
      score += h > v ? 1 : h === v ? 0.5 : 0;
      total++;
    }
  }
  return score / total;
}

/** Preflop all-in equity vs a range, by seeded simulation. */
export function preflopEquity(hero: Card[], villain: [Card, Card][], runs: number, random: () => number) {
  let score = 0;
  for (let i = 0; i < runs; i++) {
    const [v1, v2] = villain[Math.floor(random() * villain.length)]!;
    const used = new Set([...hero, v1, v2]);
    const board: Card[] = [];
    while (board.length < 5) {
      const c = FULL_DECK[Math.floor(random() * 52)]!;
      if (!used.has(c)) {
        used.add(c);
        board.push(c);
      }
    }
    const h = evaluate([...hero, ...board]).score;
    const v = evaluate([v1, v2, ...board]).score;
    score += h > v ? 1 : h === v ? 0.5 : 0;
  }
  return score / runs;
}

// ---- Puzzle generators. Each returns null for spots too close to call. ----

type Draft = Omit<Puzzle, "id" | "day" | "index" | "difficulty">;
type Band = { min: number; max: number }; // how clear the answer is (equity margin, or bb)

function deal(random: () => number, n: number, dead: Card[] = []) {
  const used = new Set(dead);
  const out: Card[] = [];
  while (out.length < n) {
    const c = FULL_DECK[Math.floor(random() * 52)]!;
    if (!used.has(c)) {
      used.add(c);
      out.push(c);
    }
  }
  return out;
}

const handLabel = (cards: Card[]) => cards.map(toDeckCode).join(" ");

/** Turn: hero holds a draw; villain (all in) has top pair or better. Pure pot odds. */
function drawPuzzle(random: () => number, band: Band): Draft | null {
  const board = deal(random, 4);
  const hero = deal(random, 2, board);
  const all = [...hero, ...board];
  // Hero must have a draw and nothing better than one pair right now.
  const made = evaluate(all);
  if (Math.floor(made.score / 0x100000) >= 2) return null; // two pair or better: not a draw spot
  const suits = new Map<string, number>();
  for (const c of all) suits.set(suitOf(c), (suits.get(suitOf(c)) ?? 0) + 1);
  const flushDraw = [...suits.values()].some((n) => n === 4) && hero.some((h) => suits.get(suitOf(h)) === 4);
  const ranks = new Set(all.map(rankOf));
  if (ranks.has(14)) ranks.add(1);
  let straightDraw = false;
  for (let lo = 1; lo <= 10; lo++) {
    const hits = [0, 1, 2, 3, 4].filter((k) => ranks.has(lo + k)).length;
    if (hits === 4 && hero.some((h) => { const r = rankOf(h); return r >= lo && r <= lo + 4; })) straightDraw = true;
  }
  if (!flushDraw && !straightDraw) return null;

  const topRank = Math.max(...board.map(rankOf));
  const villain: [Card, Card][] = [];
  const remaining = FULL_DECK.filter((c) => !all.includes(c));
  for (let i = 0; i < remaining.length; i++) for (let j = i + 1; j < remaining.length; j++) {
    const v: [Card, Card] = [remaining[i]!, remaining[j]!];
    const { score } = evaluate([...v, ...board]);
    // Score layout (src/evaluate.ts): category in bits 20+, first kicker (the pair's rank) in bits 16-19.
    const category = Math.floor(score / 0x100000);
    const pairRank = category === 1 ? (score >> 16) & 0xf : 0;
    if (category >= 2 || pairRank === topRank) villain.push(v); // top pair or better
  }
  if (villain.length < 8) return null;

  const equity = turnEquityExact(hero, board, villain);
  const potBefore = pick([60, 80, 100, 120, 160], random);
  const shove = Math.round(potBefore * pick([0.5, 0.75, 1, 1.5, 2], random));
  const needed = shove / (potBefore + 2 * shove);
  const margin = equity - needed;
  if (Math.abs(margin) < band.min || Math.abs(margin) > band.max) return null;
  const answer: Choice = margin > 0 ? "call" : "fold";
  const drawName = flushDraw && straightDraw ? "flush and straight draw" : flushDraw ? "flush draw" : "straight draw";
  return {
    kind: "draw",
    title: `Chasing a ${drawName}`,
    street: "turn",
    hero: hero.map(toDeckCode),
    board: board.map(toDeckCode),
    position: "On the turn, heads-up",
    situation: `The pot is ${potBefore}. Your opponent moves all in for ${shove}. Call ${shove} to win ${potBefore + shove}?`,
    assumption: "Assume your opponent has top pair or better. They're all in, so there's no more betting: you either hit on the river or you don't.",
    pot: potBefore + shove,
    toCall: shove,
    bigBlind: 20,
    heroStack: shove * 3,
    options: [
      { id: "fold", label: "Fold" },
      { id: "call", label: `Call ${shove}` },
    ],
    solution: {
      answer,
      explanation:
        `Your ${drawName} (${handLabel(hero)}) wins ${pct(equity)} of the time against top pair or better on this board. ` +
        `Calling ${shove} into a final pot of ${potBefore + 2 * shove} needs ${pct(needed)}. ` +
        (answer === "call" ? `You have ${pct(margin)} more than you need, so calling makes money long-term.` : `You're ${pct(-margin)} short, so folding saves chips.`),
      numbers: [
        { label: "Your equity", value: pct(equity) },
        { label: "Pot odds needed", value: pct(needed) },
        { label: "Opponent hands", value: `${villain.length} combos` },
      ],
    },
  };
}

/** Cheap 3,000-run estimate first; the full 20,000 runs only if the spot might fit the band. */
function screenedEquity(hero: Card[], villain: [Card, Card][], random: () => number, edgeOf: (eq: number) => number, band: Band) {
  const quick = edgeOf(preflopEquity(hero, villain, 3_000, random));
  if (Math.abs(quick) < band.min * 0.5 || Math.abs(quick) > band.max * 1.5 + 0.5) return null;
  return preflopEquity(hero, villain, 20_000, random);
}

/** Preflop, heads-up small blind: shove or fold vs a stated calling range. */
function shovePuzzle(random: () => number, band: Band): Draft | null {
  const stack = pick([5, 6, 7, 8, 10, 12, 15], random); // big blinds
  const callPct = pick([0.1, 0.15, 0.2, 0.3, 0.4, 0.5], random);
  const hero = deal(random, 2);
  const villain = topRange(callPct, hero);
  const pCall = villain.length / ((50 * 49) / 2);
  // In big blinds from the start of the hand: you posted 0.5, they posted 1.
  const evFold = -0.5;
  const equity = screenedEquity(hero, villain, random, (eq) => (1 - pCall) + pCall * (eq * 2 * stack - stack) - evFold, band);
  if (equity === null) return null;
  const evShove = (1 - pCall) * 1 + pCall * (equity * 2 * stack - stack);
  const edge = evShove - evFold;
  if (Math.abs(edge) < band.min || Math.abs(edge) > band.max) return null;
  const answer: Choice = edge > 0 ? "shove" : "fold";
  return {
    kind: "shove",
    title: `${stack} big blinds: shove or fold?`,
    street: "preflop",
    hero: hero.map(toDeckCode),
    board: [],
    position: "Small blind, heads-up",
    situation: `Blinds 10/20. You have ${stack} big blinds (${stack * 20} chips). It's folded to you in the small blind.`,
    assumption: `Assume the big blind calls an all-in with the top ${Math.round(callPct * 100)}% of hands and folds the rest.`,
    pot: 30,
    toCall: 10,
    bigBlind: 20,
    heroStack: stack * 20,
    options: [
      { id: "fold", label: "Fold" },
      { id: "shove", label: `All in (${stack * 20})` },
    ],
    solution: {
      answer,
      explanation:
        `They call ${pct(pCall)} of the time; when they call, ${handLabel(hero)} wins ${pct(equity)}. ` +
        `Shoving averages ${bb(evShove)} against ${bb(evFold)} for folding, so ${answer === "shove" ? "shoving" : "folding"} is better by ${Math.abs(edge).toFixed(2)} bb.`,
      numbers: [
        { label: "They call", value: pct(pCall) },
        { label: "Equity when called", value: pct(equity) },
        { label: "Shove vs fold", value: `${bb(evShove)} vs ${bb(evFold)}` },
      ],
    },
  };
}

/** Preflop, heads-up big blind: call or fold an all-in from a stated shoving range. */
function defendPuzzle(random: () => number, band: Band): Draft | null {
  const stack = pick([6, 8, 10, 12, 15, 20], random);
  const shovePct = pick([0.1, 0.2, 0.3, 0.45, 0.6], random);
  const hero = deal(random, 2);
  const villain = topRange(shovePct, hero);
  // From the start of the hand: you posted 1 big blind.
  const evFold = -1;
  const equity = screenedEquity(hero, villain, random, (eq) => eq * 2 * stack - stack - evFold, band);
  if (equity === null) return null;
  const evCall = equity * 2 * stack - stack;
  const edge = evCall - evFold;
  if (Math.abs(edge) < band.min || Math.abs(edge) > band.max) return null;
  const answer: Choice = edge > 0 ? "call" : "fold";
  const needed = (stack - 1) / (2 * stack);
  return {
    kind: "defend",
    title: `Facing a ${stack} big blind shove`,
    street: "preflop",
    hero: hero.map(toDeckCode),
    board: [],
    position: "Big blind, heads-up",
    situation: `Blinds 10/20. The small blind moves all in for ${stack} big blinds (${stack * 20}). You have them covered.`,
    assumption: `Assume the small blind shoves the top ${Math.round(shovePct * 100)}% of hands.`,
    pot: stack * 20 + 20,
    toCall: (stack - 1) * 20,
    bigBlind: 20,
    heroStack: stack * 20 + 400,
    options: [
      { id: "fold", label: "Fold" },
      { id: "call", label: `Call ${(stack - 1) * 20}` },
    ],
    solution: {
      answer,
      explanation:
        `${handLabel(hero)} wins ${pct(equity)} against that range; calling needs ${pct(needed)}. ` +
        `Calling averages ${bb(evCall)} against ${bb(evFold)} for folding, so ${answer === "call" ? "calling" : "folding"} is better by ${Math.abs(edge).toFixed(2)} bb.`,
      numbers: [
        { label: "Your equity", value: pct(equity) },
        { label: "Equity needed", value: pct(needed) },
        { label: "Call vs fold", value: `${bb(evCall)} vs ${bb(evFold)}` },
      ],
    },
  };
}

// ---- The daily set ----

const PLAN: { kind: PuzzleKind; difficulty: PuzzleView["difficulty"] }[] = [
  { kind: "shove", difficulty: "easy" },
  { kind: "draw", difficulty: "easy" },
  { kind: "defend", difficulty: "medium" },
  { kind: "draw", difficulty: "hard" },
  { kind: "shove", difficulty: "hard" },
];

/** How clear each difficulty's answer is: equity margin for draws, big blinds for preflop. */
const BANDS: Record<PuzzleView["difficulty"], { equity: Band; bb: Band }> = {
  easy: { equity: { min: 0.15, max: 1 }, bb: { min: 1.5, max: 99 } },
  medium: { equity: { min: 0.07, max: 0.15 }, bb: { min: 0.6, max: 1.5 } },
  hard: { equity: { min: 0.03, max: 0.07 }, bb: { min: 0.3, max: 0.6 } },
};

const cache = new Map<string, Puzzle[]>();

/** The day's five puzzles (UTC date "YYYY-MM-DD"), generated once and cached. */
export function dailyPuzzles(day: string): Puzzle[] {
  const hit = cache.get(day);
  if (hit) return hit;
  const puzzles = PLAN.map(({ kind, difficulty }, index) => {
    const random = rngFrom(`horns-puzzles:${day}:${index}`);
    for (let attempt = 0; attempt < 400; attempt++) {
      const draft =
        kind === "draw" ? drawPuzzle(random, BANDS[difficulty].equity)
        : kind === "shove" ? shovePuzzle(random, BANDS[difficulty].bb)
        : defendPuzzle(random, BANDS[difficulty].bb);
      if (draft) return { ...draft, id: `${day}#${index + 1}`, day, index: index + 1, difficulty };
    }
    throw new Error(`no ${difficulty} ${kind} puzzle found for ${day}`);
  });
  cache.set(day, puzzles);
  if (cache.size > 7) cache.delete(cache.keys().next().value!);
  return puzzles;
}

export const today = () => new Date().toISOString().slice(0, 10);

export function publicPuzzle(p: Puzzle): PuzzleView {
  const { solution: _solution, ...view } = p;
  return view;
}
