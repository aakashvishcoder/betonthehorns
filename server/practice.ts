import { AiPlayer, type TableView } from "./src/ai/ai-player.ts";
import { snowflakeAuthFromEnv } from "./src/ai/cortex.ts";
import { aiSeats, isAi, personaOf } from "./src/ai/personas.ts";
import { MemoryStyleStore, SnowflakeStyleStore, type StyleStore } from "./src/ai/style-store.ts";
import { StatsTracker, blendStyle, skillFromElo } from "./src/ai/style.ts";
import { DailyCap } from "./src/coach.ts";
import { cardCode } from "./poker.js";
import { legalActions } from "./engine.js";
import type { ActionInput, Card, GameMode, MatchState } from "./types.js";

/**
 * Practice vs AI and play-style data, on top of the main engine:
 * - AI seats (The Shark / Maniac / Rock) decide with Snowflake Cortex, falling back to rules
 * - every human's per-game style counters go to Snowflake (PLAYER_STYLE view) when a game ends,
 *   and the next practice game mirrors that style at a skill level matching their Elo
 * Env: SNOWFLAKE_ACCOUNT + SNOWFLAKE_PAT (without them: rule-based AIs, styles kept in memory).
 */
const snowflake = snowflakeAuthFromEnv();
export const styleStore: StyleStore = snowflake ? new SnowflakeStyleStore(snowflake) : new MemoryStyleStore();
const practiceToday = new DailyCap(Number(process.env.AI_PRACTICE_PER_DAY ?? 5));
/** Human-like pause before an AI acts, in ms (tests set it to [0, 0]). */
export const AI_TIMING = { thinkMs: [1_000, 2_500] as [number, number] };

const ais = new Map<string, Map<string, AiPlayer>>(); // match id -> AI seats
const thinking = new Set<string>(); // "match:move" keys already being decided
/** Actions taken per match; identifies each AI turn uniquely (the engine doesn't log every action). */
const moves = new Map<string, number>();
const trackers = new Map<string, { stats: StatsTracker; hand: number; ended: boolean }>();

console.log(`[ai] practice opponents: ${snowflake ? "Snowflake Cortex + style data" : "rules only (no SNOWFLAKE_* env)"}`);

/** Card {rank, suit} -> "As", "Td" (the AI modules' format). */
const code = (card: Card) => `${cardCode(card).slice(0, -1)}${card.suit.toLowerCase()}`;

export function takePracticeGame(walletId: string) {
  return practiceToday.take(walletId);
}
export function refundPracticeGame(walletId: string) {
  practiceToday.refund(walletId);
}

/** Builds the AI seats for a practice table, mirroring this player's style at their Elo. */
export async function practiceSeats(walletId: string, mode: GameMode, seats: number, elo: number) {
  const observed = await styleStore.styleOf(walletId).catch((error) => {
    console.warn("[ai] style lookup:", (error as Error).message);
    return null;
  });
  const mirrored = blendStyle(observed, elo);
  const skill = skillFromElo(elo);
  const ids = aiSeats(seats - 1);
  const players = new Map(ids.map((id) => [id, new AiPlayer(id, personaOf(id)!, mirrored, skill, snowflake)]));
  console.log(`[ai] practice for ${walletId.slice(0, 4)}… (${mode}, Elo ${elo}, ${observed ? `${observed.hands} hands of history` : "no history"})`);
  return { ids, players };
}

export function registerPractice(match: MatchState, players: Map<string, AiPlayer>) {
  ais.set(match.id, players);
}

function viewFor(match: MatchState, id: string): TableView {
  const me = match.players.find((p) => p.walletId === id)!;
  const legal = legalActions(match, id);
  return {
    street: match.street,
    cards: (me.hole ?? []).map(code),
    board: match.board.map(code),
    pot: match.pot,
    stack: me.stack,
    smallBlind: match.blinds.sb,
    bigBlind: match.blinds.bb,
    opponents: match.players.filter((p) => p.walletId !== id && !p.busted).map((p) => ({ stack: p.stack, folded: p.folded, allIn: p.allIn })),
    legal: {
      toCall: legal.toCall,
      canCheck: legal.canCheck,
      canRaise: legal.maxRaiseTo > match.currentBet,
      minRaiseTo: legal.minRaiseTo,
      maxRaiseTo: legal.maxRaiseTo,
    },
  };
}

/**
 * If an AI seat is to act, decide (Cortex while a human is still in the game, rules otherwise)
 * after a human-like pause, then call `act`. Safe to call on every tick.
 */
export function driveAi(match: MatchState, act: (walletId: string, input: ActionInput) => Promise<void>) {
  const seats = ais.get(match.id);
  if (!seats || match.status !== "playing" || match.actionIndex === null) return;
  const actor = match.players[match.actionIndex]!;
  const ai = seats.get(actor.walletId);
  if (!ai) return;
  const key = `${match.id}:${moves.get(match.id) ?? 0}`;
  if (thinking.has(key)) return;
  thinking.add(key);

  const humanIn = match.players.some((p) => !p.bot && !p.busted);
  const view = viewFor(match, actor.walletId);
  const bigSpot = view.legal.toCall > 0.2 * view.stack;
  const [min, max] = AI_TIMING.thinkMs;
  const pause = min + Math.random() * (max - min) + (bigSpot && max > 0 ? 1_500 : 0);
  void Promise.all([ai.decide(view, { useCortex: humanIn }), new Promise((r) => setTimeout(r, pause))])
    .then(async ([decision]) => {
      if (match.status !== "playing" || match.players[match.actionIndex ?? -1]?.walletId !== actor.walletId) return;
      if (decision.error) console.warn(`[ai] ${actor.walletId} fell back to rules: ${decision.error}`);
      const a = decision.action;
      await act(actor.walletId, a.type === "raise" ? { type: "raise", raiseTo: a.to } : { type: a.type });
    })
    .catch((error) => console.warn("[ai] move failed:", (error as Error).message))
    .finally(() => setTimeout(() => thinking.delete(key), 30_000).unref());
}

/** Practice is over for the human once they bust: don't let the AIs play on alone. */
export function humanBustedOut(match: MatchState) {
  return ais.has(match.id) && match.players.filter((p) => !p.bot).every((p) => p.busted);
}

// ---- Style counters (all games, ranked and practice) ----

/** Call before applying any action (human, timeout or AI). */
export function trackAction(match: MatchState, walletId: string, input: ActionInput) {
  moves.set(match.id, (moves.get(match.id) ?? 0) + 1);
  syncHands(match);
  const t = trackers.get(match.id)!;
  const action = input.type === "raise" ? { type: "raise" as const, to: input.raiseTo ?? 0 } : { type: input.type };
  t.stats.action(walletId, action, match.street === "complete" ? "river" : match.street);
}

/** Call whenever the match changes (e.g. on every broadcast) to close and open hands. */
export function syncHands(match: MatchState) {
  let t = trackers.get(match.id);
  if (!t) {
    t = { stats: new StatsTracker(), hand: 0, ended: true };
    trackers.set(match.id, t);
  }
  const handOver = match.street === "showdown" || match.street === "complete";
  if (!t.ended && (handOver || match.handNumber !== t.hand)) {
    const winners = new Set(match.winners.map((w) => w.walletId));
    const wentToShowdown = match.winners.some((w) => w.hand !== undefined);
    const shown = wentToShowdown ? match.players.filter((p) => p.hole && !p.folded) : [];
    t.stats.handEnded(match.board.length >= 3, shown.map((p) => ({ player: p.walletId, won: winners.has(p.walletId) })));
    t.ended = true;
  }
  if (match.handNumber !== t.hand && !handOver) {
    t.hand = match.handNumber;
    t.ended = false;
    t.stats.handStarted(match.players.filter((p) => !p.busted).map((p) => p.walletId));
  }
}

/** When a game ends: one style row per human to Snowflake, then forget the match. */
export async function finishTracking(match: MatchState) {
  syncHands(match);
  const t = trackers.get(match.id);
  trackers.delete(match.id);
  ais.delete(match.id);
  moves.delete(match.id);
  if (!t) return;
  const mode = ({ "hands-up": "heads_up", "sng-4": "four", "sng-6": "six" } as const)[match.mode];
  const rows = match.players
    .filter((p) => !p.bot && !isAi(p.walletId))
    .flatMap((p) => {
      const s = t.stats.stats.get(p.walletId);
      return s ? [{ ...s, wallet: p.walletId, mode, ranked: match.ranked, place: match.places[p.walletId] ?? 0, players: match.players.length }] : [];
    });
  await styleStore.record(rows).catch((error) => console.warn("[ai] style write:", (error as Error).message));
}
