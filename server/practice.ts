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
 * Practice vs AI and play-style data, on top of the main engine. Nothing here lives in a
 * server's memory between requests (serverless): the AI seats' style and skill are stored in
 * the match, each AI decision rebuilds its seat, and style stats are replayed from the
 * match's hand history when it ends.
 * - AI seats (The Shark / Maniac / Rock) decide with Snowflake Cortex, falling back to rules
 * - every human's per-game style counters go to Snowflake (PLAYER_STYLE view) when a game ends,
 *   and the next practice game mirrors that style at a skill level matching their Elo
 * Env: SNOWFLAKE_ACCOUNT + SNOWFLAKE_PAT (without them: rule-based AIs, styles kept in memory).
 */
const snowflake = snowflakeAuthFromEnv();
export const styleStore: StyleStore = snowflake ? new SnowflakeStyleStore(snowflake) : new MemoryStyleStore();
// ponytail: per-instance cap; count today's practice matches in the database if it must be exact.
const practiceToday = new DailyCap(Number(process.env.AI_PRACTICE_PER_DAY ?? 5));
/** Human-like pause before an AI acts, in ms (tests set it to 0). */
export const AI_TIMING = { thinkMs: 1_400 };

console.log(`[ai] practice opponents: ${snowflake ? "Snowflake Cortex + style data" : "rules only (no SNOWFLAKE_* env)"}`);

/** Card {rank, suit} -> "As", "Td" (the AI modules' format). */
const code = (card: Card) => `${cardCode(card).slice(0, -1)}${card.suit.toLowerCase()}`;

export function takePracticeGame(walletId: string) {
  return practiceToday.take(walletId);
}
export function refundPracticeGame(walletId: string) {
  practiceToday.refund(walletId);
}

/** The AI seat ids and the style/skill they'll play with, mirroring this player at their Elo. */
export async function practiceSeats(walletId: string, mode: GameMode, seats: number, elo: number) {
  const observed = await styleStore.styleOf(walletId).catch((error) => {
    console.warn("[ai] style lookup:", (error as Error).message);
    return null;
  });
  console.log(`[ai] practice for ${walletId.slice(0, 4)}… (${mode}, Elo ${elo}, ${observed ? `${observed.hands} hands of history` : "no history"})`);
  return { ids: aiSeats(seats - 1), ai: { style: blendStyle(observed, elo), skill: skillFromElo(elo) } };
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

/** The AI seat whose turn it is, once it has "thought" for a moment; otherwise null. */
export function aiToAct(match: MatchState, now = Date.now()) {
  if (!match.ai || match.status !== "playing" || match.actionIndex === null || match.runoutAt) return null;
  if (match.street === "showdown" || match.street === "complete") return null;
  const actor = match.players[match.actionIndex];
  if (!actor?.bot || !isAi(actor.walletId)) return null;
  return now >= (match.lastActionAt ?? 0) + AI_TIMING.thinkMs ? actor.walletId : null;
}

/** Decide the AI seat's move (Cortex while a human is still in the game, rules otherwise). */
export async function decideAi(match: MatchState, walletId: string): Promise<ActionInput> {
  const persona = personaOf(walletId)!;
  const seat = new AiPlayer(walletId, persona, match.ai!.style, match.ai!.skill, snowflake);
  const humanIn = match.players.some((p) => !p.bot && !p.busted);
  const decision = await seat.decide(viewFor(match, walletId), { useCortex: humanIn });
  if (decision.error) console.warn(`[ai] ${walletId} fell back to rules: ${decision.error}`);
  const a = decision.action;
  return a.type === "raise" ? { type: "raise", raiseTo: a.to } : { type: a.type };
}

/** When a game ends: replay its hand history into style counters, one row per human. */
export async function finishTracking(match: MatchState) {
  const stats = new StatsTracker();
  for (const hand of match.history ?? []) {
    stats.handStarted(Object.keys(hand.stacks));
    for (const a of hand.actions) {
      const action = a.action === "raise" ? { type: "raise" as const, to: a.raiseTo ?? 0 } : { type: a.action as "fold" | "check" | "call" };
      stats.action(a.player, action, (a.street === "complete" || a.street === "showdown" ? "river" : a.street) as "preflop" | "flop" | "turn" | "river");
    }
    const winners = new Set(hand.winners.map((w) => w.player));
    stats.handEnded(hand.board.length >= 3, hand.shown.map((player) => ({ player, won: winners.has(player) })));
  }
  const mode = ({ "hands-up": "heads_up", "sng-4": "four", "sng-6": "six" } as const)[match.mode];
  const rows = match.players
    .filter((p) => !p.bot && !isAi(p.walletId))
    .flatMap((p) => {
      const s = stats.stats.get(p.walletId);
      return s ? [{ ...s, wallet: p.walletId, mode, ranked: match.ranked, place: match.places[p.walletId] ?? 0, players: match.players.length }] : [];
    });
  await styleStore.record(rows).catch((error) => console.warn("[ai] style write:", (error as Error).message));
}
