import { cardCode } from "./poker.js";
import { query } from "./db.js";
import { dbReady } from "./schema.js";
import type { ActionInput, MatchState } from "./types.js";

/**
 * Hand histories for post-game analysis: every decision with the pot, price and stack at that
 * moment, plus each hand's cards and result. Kept in memory while the match runs and saved to
 * hand_histories when it ends. All hole cards are stored; viewFor() hides the ones a player
 * couldn't have seen.
 */
export type HistoryAction = {
  street: string;
  player: string;
  action: string;
  raiseTo?: number;
  pot: number;
  toCall: number;
  stack: number;
};
export type HistoryHand = {
  hand: number;
  blinds: { sb: number; bb: number };
  dealer: string;
  stacks: Record<string, number>;
  holes: Record<string, string[]>;
  board: string[];
  actions: HistoryAction[];
  /** Players whose cards were shown at showdown. */
  shown: string[];
  winners: { player: string; amount: number; hand?: string }[];
};
export type MatchHistory = {
  matchId: string;
  mode: string;
  /** False for practice vs AI. Missing on histories saved before practice was recorded. */
  ranked?: boolean;
  players: string[];
  places: Record<string, number>;
  hands: HistoryHand[];
};

const live = new Map<string, HistoryHand[]>();

function currentHand(match: MatchState) {
  const hands = live.get(match.id) ?? [];
  live.set(match.id, hands);
  let hand = hands.at(-1);
  if (!hand || hand.hand !== match.handNumber) {
    hand = {
      hand: match.handNumber,
      blinds: { ...match.blinds },
      dealer: match.players[match.dealerIndex]?.walletId ?? "",
      // Stacks before the blinds went in.
      stacks: Object.fromEntries(match.players.filter((p) => !p.busted || p.bet > 0).map((p) => [p.walletId, p.stack + p.bet])),
      holes: Object.fromEntries(match.players.filter((p) => p.hole).map((p) => [p.walletId, p.hole!.map(cardCode)])),
      board: [],
      actions: [],
      shown: [],
      winners: [],
    };
    hands.push(hand);
  }
  return hand;
}

/** Call before applying any action (human, AI or timeout), next to trackAction. */
export function recordAction(match: MatchState, walletId: string, input: ActionInput) {
  if (match.status !== "playing") return;
  const hand = currentHand(match);
  const me = match.players.find((p) => p.walletId === walletId);
  hand.actions.push({
    street: match.street,
    player: walletId,
    action: input.type,
    ...(input.type === "raise" ? { raiseTo: input.raiseTo } : {}),
    pot: match.pot,
    toCall: Math.max(0, match.currentBet - (me?.bet ?? 0)),
    stack: me?.stack ?? 0,
  });
}

/** Call on every broadcast: fills in the board, showdown and winners once a hand is decided. */
export function syncHistory(match: MatchState) {
  const hand = live.get(match.id)?.at(-1);
  if (!hand || hand.hand !== match.handNumber) return;
  if (match.street === "showdown" || match.street === "complete") {
    hand.board = match.board.map(cardCode);
    hand.winners = match.winners.map((w) => ({ player: w.walletId, amount: w.amount, ...(w.hand ? { hand: w.hand } : {}) }));
    if (match.winners.some((w) => w.hand !== undefined)) {
      hand.shown = match.players.filter((p) => p.hole && !p.folded).map((p) => p.walletId);
    }
  }
}

/** When a match ends: save its history (ranked and practice) and drop it from memory. */
export async function saveHistory(match: MatchState) {
  syncHistory(match);
  const hands = live.get(match.id) ?? [];
  live.delete(match.id);
  if (!dbReady || hands.length === 0) return;
  const history: MatchHistory = {
    matchId: match.id,
    mode: match.mode,
    ranked: match.ranked,
    players: match.players.map((p) => p.walletId),
    places: match.places,
    hands,
  };
  await query(
    `INSERT INTO hand_histories (match_id, history) VALUES ($1, $2) ON CONFLICT (match_id) DO NOTHING`,
    [match.id, JSON.stringify(history)],
  ).catch((error) => console.warn("[db] hand history", (error as Error).message));
}

/** The hands recorded so far for a running match. */
export function liveHands(matchId: string): readonly HistoryHand[] {
  return live.get(matchId) ?? [];
}

export async function loadHistory(matchId: string): Promise<MatchHistory | null> {
  if (!dbReady) return null;
  const result = await query<{ history: MatchHistory }>(`SELECT history FROM hand_histories WHERE match_id = $1`, [matchId]);
  return result.rows[0]?.history ?? null;
}

/** What `viewer` could see: their own cards always, others only if shown at showdown. */
export function viewFor(history: MatchHistory, viewer: string): MatchHistory {
  return {
    ...history,
    hands: history.hands.map((h) => ({
      ...h,
      holes: Object.fromEntries(Object.entries(h.holes).filter(([p]) => p === viewer || h.shown.includes(p))),
    })),
  };
}
