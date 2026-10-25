import { query } from "./db.js";
import { dbReady } from "./schema.js";
import { loadHistory, viewFor, type HistoryHand, type MatchHistory } from "./history.js";
import { dailyPuzzles } from "./puzzles.js";
import { attemptsFor } from "./puzzle-store.js";
import { evaluate } from "./poker.js";
import { seatLabel } from "./names.js";
import { cortexJson, snowflakeAuthFromEnv } from "./src/ai/cortex.ts";
import type { Card } from "./types.js";

/**
 * Post-game analysis by Claude Sonnet 4.5 on Snowflake Cortex, on request:
 * - ranked and practice (vs AI) matches: grade, strengths, leaks and the 3 most important hands, from the hand history
 *   (only cards the player could see)
 * - a finished day of puzzles: what the five answers say about the player's game
 * Private to the player, saved so re-opening is free, and capped per wallet per day.
 */
export const ANALYSIS = {
  model: process.env.ANALYSIS_MODEL ?? "claude-sonnet-4-5",
  perDay: Number(process.env.ANALYSIS_PER_DAY ?? 5),
};
const snowflake = snowflakeAuthFromEnv();

export type Analysis = {
  grade: string;
  headline: string;
  summary: string;
  strengths: string[];
  leaks: string[];
  keyHands: { ref: string; title: string; youDid: string; better: string; why: string }[];
  focus: string;
};
type Kind = "match" | "puzzles";

const SCHEMA = {
  name: "post_game_analysis",
  schema: {
    type: "object",
    properties: {
      grade: { type: "string", description: "Letter grade A+ to F for the quality of decisions (not the result)" },
      headline: { type: "string", description: "One sentence verdict" },
      summary: { type: "string", description: "2-4 sentences on how they played" },
      strengths: { type: "array", items: { type: "string" }, description: "1-3 things done well" },
      leaks: { type: "array", items: { type: "string" }, description: "1-3 mistakes or tendencies to fix" },
      keyHands: {
        type: "array",
        description: "Up to 3 of the most instructive spots, most important first",
        items: {
          type: "object",
          properties: {
            ref: { type: "string", description: 'e.g. "Hand 7" or "Puzzle 3"' },
            title: { type: "string" },
            youDid: { type: "string" },
            better: { type: "string", description: "The better play, or confirm theirs was right" },
            why: { type: "string", description: "The reasoning with numbers: pot odds, equity, ranges, stack depth" },
          },
          required: ["ref", "title", "youDid", "better", "why"],
          additionalProperties: false,
        },
      },
      focus: { type: "string", description: "The one thing to work on next" },
    },
    required: ["grade", "headline", "summary", "strengths", "leaks", "keyHands", "focus"],
    additionalProperties: false,
  },
};

const SYSTEM = `You are an expert No-Limit Hold'em coach reviewing one player's decisions after a game.
Cards use standard notation (Kc = king of clubs). Made hands given in parentheses come from a hand evaluator and are always correct: trust them over your own reading of the cards.
Judge decisions, not results: a good call that lost is still good. Use the numbers given (pot, price, stacks in big blinds) and do the math: pot odds, required equity, stack-to-pot ratio, push/fold ranges for short stacks.
Only use cards listed as known. Unknown opponent hands must be reasoned about as ranges, never guessed as specific cards.
Speak to the player as "you". Be specific, concise and encouraging; no generic advice.`;

export async function migrateAnalysis() {
  await query(`
    CREATE TABLE IF NOT EXISTS hand_histories (
      match_id TEXT PRIMARY KEY,
      history JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS post_game_analysis (
      wallet_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      content JSONB NOT NULL,
      model TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (wallet_id, kind, ref)
    );
  `);
}

export class AnalysisError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function savedAnalysis(walletId: string, kind: Kind, ref: string): Promise<Analysis | null> {
  if (!dbReady) return null;
  const result = await query<{ content: Analysis }>(
    `SELECT content FROM post_game_analysis WHERE wallet_id = $1 AND kind = $2 AND ref = $3`,
    [walletId, kind, ref],
  );
  return result.rows[0]?.content ?? null;
}

const running = new Map<string, Promise<Analysis>>();

/** Returns the saved analysis, or writes one (one model call, counted against the daily cap). */
export function analyze(walletId: string, kind: Kind, ref: string): Promise<Analysis> {
  const key = `${walletId}|${kind}|${ref}`;
  let job = running.get(key);
  if (!job) {
    job = run(walletId, kind, ref).finally(() => running.delete(key));
    running.set(key, job);
  }
  return job;
}

async function run(walletId: string, kind: Kind, ref: string): Promise<Analysis> {
  if (!dbReady) throw new AnalysisError("Analysis needs the database.", 503);
  if (!snowflake) throw new AnalysisError("Analysis isn't configured (no Snowflake keys).", 503);
  const saved = await savedAnalysis(walletId, kind, ref);
  if (saved) return saved;

  const prompt = kind === "match" ? await matchPrompt(walletId, ref) : await puzzlePrompt(walletId, ref);
  const used = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM post_game_analysis WHERE wallet_id = $1 AND created_at > date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [walletId],
  );
  if (Number(used.rows[0]!.n) >= ANALYSIS.perDay) {
    throw new AnalysisError(`You've used today's ${ANALYSIS.perDay} analyses. Saved ones stay readable; more tomorrow.`, 429);
  }

  const { data, tokens } = await cortexJson<Analysis>(snowflake, ANALYSIS.model, SYSTEM, prompt, SCHEMA);
  const analysis: Analysis = { ...data, keyHands: data.keyHands.slice(0, 3), strengths: data.strengths.slice(0, 3), leaks: data.leaks.slice(0, 3) };
  console.log(`[analysis] ${kind} ${ref.slice(0, 8)} for ${walletId.slice(0, 4)}… (${tokens?.in ?? "?"} in / ${tokens?.out ?? "?"} out tokens)`);
  await query(
    `INSERT INTO post_game_analysis (wallet_id, kind, ref, content, model) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
    [walletId, kind, ref, JSON.stringify(analysis), ANALYSIS.model],
  );
  return analysis;
}

// ---- Prompts ----

const MAX_HANDS = 40;

async function matchPrompt(walletId: string, matchId: string) {
  const full = await loadHistory(matchId);
  if (!full) throw new AnalysisError("No hand history for this game (only games played after this update).", 404);
  if (!full.players.includes(walletId)) throw new AnalysisError("You weren't in this game.", 403);
  return describeMatch(viewFor(full, walletId), walletId);
}

/** Text hand history from the player's seat, amounts in big blinds. Exported for tests. */
export function describeMatch(history: MatchHistory, me: string) {
  const name = (id: string) => (id === me ? "You" : `Opp${history.players.filter((p) => p !== me).indexOf(id) + 1}`);
  // Long games: keep the hands you played with the biggest pots.
  const mine = history.hands.filter((h) => h.actions.some((a) => a.player === me));
  const picked = mine.length > MAX_HANDS
    ? [...mine].sort((a, b) => potOf(b) - potOf(a)).slice(0, MAX_HANDS).sort((a, b) => a.hand - b.hand)
    : mine;
  const lines = [
    history.ranked === false
      ? `Practice game against AI bots (${history.players.filter((p) => p !== me).map((p) => `${name(p)} = ${seatLabel(p)}`).join(", ")}), unranked.`
      : "Ranked game against human players.",
    `Game: ${history.mode}, ${history.players.length} players. You finished place ${history.places[me] ?? "?"} of ${history.players.length}.`,
    `Hands played: ${history.hands.length}${picked.length < mine.length ? ` (showing the ${picked.length} biggest you played)` : ""}.`,
    "",
    ...picked.map((h) => describeHand(h, name, me)),
  ];
  return lines.join("\n");
}

/** "KC" -> "Kc": standard notation, so suit letters aren't misread as ranks. */
const show = (codes: string[]) => codes.map((c) => `${c[0]}${c[1]!.toLowerCase()}`).join(" ");
const toCard = (code: string): Card => ({ rank: "23456789TJQKA".indexOf(code[0]!) + 2, suit: code[1] as Card["suit"] });
/** The made hand from these cards, from our evaluator, so the model never has to work it out. */
const madeHand = (hole: string[], board: string[]) => evaluate(hole.map(toCard), board.map(toCard)).name;

function potOf(h: HistoryHand) {
  return h.winners.reduce((s, w) => s + w.amount, 0);
}

function describeHand(h: HistoryHand, name: (id: string) => string, me: string) {
  const bb = (chips: number) => `${+(chips / h.blinds.bb).toFixed(1)}bb`;
  const out = [
    `Hand ${h.hand} (blinds ${h.blinds.sb}/${h.blinds.bb}, dealer ${name(h.dealer)})`,
    `  Stacks: ${Object.entries(h.stacks).map(([p, s]) => `${name(p)} ${bb(s)}`).join(", ")}`,
    `  Known cards: ${Object.entries(h.holes).map(([p, c]) => `${name(p)} ${show(c)}`).join(", ") || "none"}`,
  ];
  let street = "";
  for (const a of h.actions) {
    if (a.street !== street) {
      street = a.street;
      const cards = { flop: 3, turn: 4, river: 5 }[street];
      const board = cards && h.board.length >= cards ? h.board.slice(0, cards) : null;
      const mine = h.holes[me];
      out.push(`  ${street}${board ? ` [${show(board)}]${mine ? ` (you have: ${madeHand(mine, board)})` : ""}` : ""}:`);
    }
    const s = a.player === me ? "" : "s";
    const what = a.action === "raise" ? `raise${s} to ${bb(a.raiseTo ?? 0)}` : a.action === "call" ? `call${s} ${bb(a.toCall)}` : `${a.action}${s}`;
    out.push(`    ${name(a.player)} ${what} (pot ${bb(a.pot)}, to call ${bb(a.toCall)}, stack ${bb(a.stack)})`);
  }
  if (h.board.length) {
    const known = Object.entries(h.holes).map(([p, c]) => `${name(p)} ${madeHand(c, h.board)}`).join(", ");
    out.push(`  Board: ${show(h.board)}${known ? ` (final hands: ${known})` : ""}`);
  }
  out.push(`  Result: ${h.winners.map((w) => `${name(w.player)} win${w.player === me ? "" : "s"} ${bb(w.amount)}${w.hand ? ` with ${w.hand}` : ""}`).join("; ") || "unknown"}`);
  return out.join("\n");
}

async function puzzlePrompt(walletId: string, day: string) {
  const attempts = await attemptsFor(walletId, day);
  const puzzles = dailyPuzzles(day);
  if (attempts.length < puzzles.length) throw new AnalysisError("Finish all five puzzles first.", 400);
  const lines = [`Daily puzzles for ${day}. The player answered ${attempts.filter((a) => a.correct).length}/${puzzles.length} correctly.`, ""];
  for (const p of puzzles) {
    const a = attempts.find((x) => x.index === p.index)!;
    const label = (id: string) => p.options.find((o) => o.id === id)?.label ?? id;
    lines.push(
      `Puzzle ${p.index} (${p.difficulty}, ${p.street}, ${p.position}): ${p.title}`,
      `  Hand: ${show(p.hero)}${p.board.length ? `, board ${show(p.board)} (made hand: ${madeHand(p.hero, p.board)})` : ""}`,
      `  ${p.situation} ${p.assumption}`,
      `  They chose: ${label(a.choice)} (${a.correct ? "correct" : "wrong"}). Best: ${label(p.solution.answer)}.`,
      `  Math: ${p.solution.numbers.map((n) => `${n.label} ${n.value}`).join(", ")}. ${p.solution.explanation}`,
      "",
    );
  }
  lines.push(`Use "Puzzle N" as the ref for key spots. Focus on the pattern behind their mistakes (e.g. overvaluing draws, folding too much short-stacked), not on repeating each explanation.`);
  return lines.join("\n");
}
