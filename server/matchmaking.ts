import {
  currentElos,
  ensureWallet,
  insertMatch,
  insertMatchPlayers,
  lockEscrow,
  logMatchEvent,
  recordChainTxs,
  saveMatchSnapshot,
} from "./schema.js";
import { escrowAtRisk, rankFromElo, STARTING_ELO } from "./elo.js";
import {
  applyAction,
  continueAfterShowdown,
  createMatch,
  privateView,
  publicMatch,
  SHOWDOWN_MS,
  stepRunout,
  timeoutAct,
} from "./engine.js";
import { publish } from "./ably.js";
import { settleMatch } from "./settle.js";
import { lockMatch } from "./chain.js";
import {
  driveAi,
  finishTracking,
  practiceSeats,
  refundPracticeGame,
  registerPractice,
  syncHands,
  takePracticeGame,
  trackAction,
} from "./practice.js";
import { recordAction, saveHistory, syncHistory } from "./history.js";
import { seatLabel } from "./names.js";
import { MODE_SEATS, MODES, type ActionInput, type GameMode, type MatchState } from "./types.js";

type QueueSeat = { walletId: string; joinedAt: number };

const queues = new Map<GameMode, QueueSeat[]>(
  MODES.map((mode) => [mode, []]),
);
const matches = new Map<string, MatchState>();
const byWallet = new Map<string, string>();
const chats = new Map<string, { name: string; text: string; at: number }[]>();

function queueOf(mode: GameMode) {
  return queues.get(mode)!;
}

export function walletMatch(walletId: string) {
  const id = byWallet.get(walletId);
  return id ? matches.get(id) : undefined;
}

export function getMatch(id: string) {
  return matches.get(id);
}

export function queueSnapshot(mode: GameMode) {
  const waiting = queueOf(mode);
  return {
    mode,
    seats: MODE_SEATS[mode],
    count: waiting.length,
    wallets: waiting.map((seat) => seat.walletId),
  };
}

export async function joinQueue(walletId: string, mode: GameMode) {
  const existing = walletMatch(walletId);
  if (existing && existing.status === "playing") {
    return { status: "playing" as const, matchId: existing.id, queue: queueSnapshot(mode) };
  }
  if (existing && existing.status === "finished") {
    byWallet.delete(walletId);
  }

  leaveAllQueues(walletId);
  await ensureWallet(walletId).catch((error) =>
    console.warn("[db] ensure wallet", (error as Error).message),
  );
  queueOf(mode).push({ walletId, joinedAt: Date.now() });
  await publishQueue(mode);
  const started = await tryMatch(mode);
  if (started) {
    return { status: "playing" as const, matchId: started.id, queue: queueSnapshot(mode) };
  }
  return { status: "queued" as const, matchId: null, queue: queueSnapshot(mode) };
}

export async function leaveQueue(walletId: string) {
  for (const mode of MODES) {
    const list = queueOf(mode);
    const next = list.filter((seat) => seat.walletId !== walletId);
    if (next.length !== list.length) {
      queues.set(mode, next);
      await publishQueue(mode);
    }
  }
}

function leaveAllQueues(walletId: string) {
  for (const mode of MODES) {
    queues.set(
      mode,
      queueOf(mode).filter((seat) => seat.walletId !== walletId),
    );
  }
}

async function tryMatch(mode: GameMode) {
  const need = MODE_SEATS[mode];
  const waiting = queueOf(mode);
  if (waiting.length < need) return null;

  const taken = waiting.splice(0, need);
  queues.set(mode, waiting);
  const match = createMatch(
    mode,
    taken.map((seat) => seat.walletId),
  );
  matches.set(match.id, match);
  chats.set(match.id, []);
  for (const player of match.players) {
    if (!player.bot) byWallet.set(player.walletId, match.id);
  }

  try {
    await insertMatch(match.id, match.mode, publicMatch(match), match.commitHash);
    await insertMatchPlayers(
      match.id,
      match.players.map((player) => ({
        walletId: player.walletId,
        seat: player.seat,
        bot: player.bot,
      })),
    );
    await logMatchEvent(match.id, "started", null, {
      mode,
      players: match.players.map((player) => player.walletId),
    });
  } catch (error) {
    console.warn("[db] persist match", (error as Error).message);
  }

  const wallets = match.players.map((player) => player.walletId);
  let stakes = wallets.map((walletId) => ({ walletId, stake: 0 }));
  try {
    const elos = await currentElos(wallets, match.mode);
    for (const player of match.players) {
      player.rank = rankFromElo(elos.get(player.walletId) ?? STARTING_ELO);
    }
    stakes = escrowAtRisk(
      wallets.map((walletId) => ({
        walletId,
        elo: elos.get(walletId) ?? STARTING_ELO,
      })),
    );
    await lockEscrow(match.id, match.mode, stakes);
  } catch (error) {
    matches.delete(match.id);
    chats.delete(match.id);
    for (const walletId of wallets) byWallet.delete(walletId);
    queueOf(mode).unshift(...taken);
    console.warn("[elo] lock", (error as Error).message);
    return null;
  }

  void lockMatch({
    matchId: match.id,
    mode: match.mode,
    commitHash: match.commitHash,
    wallets,
    stakes: stakes.map((seat) => seat.stake),
  }).then(async (txs) => {
    if (txs.length === 0) return;
    match.chain.push(...txs);
    await recordChainTxs(match.id, txs).catch((error) =>
      console.warn("[chain] save", (error as Error).message),
    );
    await broadcastMatch(match);
  }).catch((error) => console.warn("[chain] lock", (error as Error).message));
  await publishQueue(mode);
  await broadcastMatch(match, "matched");
  return match;
}

/** Practice vs AI: an unranked table right away, AI personas in the other seats. */
export async function startPractice(walletId: string, mode: GameMode) {
  const existing = walletMatch(walletId);
  if (existing && existing.status === "playing") return { matchId: existing.id };
  if (existing) byWallet.delete(walletId);
  if (!takePracticeGame(walletId)) {
    throw Object.assign(new Error("You've played today's AI practice games. Come back tomorrow!"), { status: 429 });
  }
  try {
    leaveAllQueues(walletId);
    const elo = (await currentElos([walletId], mode).catch(() => new Map<string, number>())).get(walletId) ?? STARTING_ELO;
    const { ids, players } = await practiceSeats(walletId, mode, MODE_SEATS[mode], elo);
    const match = createMatch(mode, [walletId], ids, { ranked: false });
    matches.set(match.id, match);
    chats.set(match.id, []);
    byWallet.set(walletId, match.id);
    registerPractice(match, players);
    await insertMatch(match.id, match.mode, publicMatch(match), match.commitHash).catch((error) =>
      console.warn("[db] persist practice", (error as Error).message),
    );
    await broadcastMatch(match, "matched");
    return { matchId: match.id };
  } catch (error) {
    refundPracticeGame(walletId);
    throw error;
  }
}

async function publishQueue(mode: GameMode) {
  await publish(`queue:${mode}`, "waiting", queueSnapshot(mode));
}

const tracked = new Set<string>();

export async function broadcastMatch(match: MatchState, name = "state") {
  syncHands(match);
  syncHistory(match);
  // Save play-style data once per match; settleMatch skips practice (only one human).
  if (match.status === "finished" && !tracked.has(match.id)) {
    tracked.add(match.id);
    void finishTracking(match);
    void saveHistory(match);
  }
  const publicState = publicMatch(match);
  await publish(`table:${match.id}`, name, publicState);
  for (const player of match.players) {
    if (player.bot) continue;
    await publish(`wallet:${player.walletId}`, name, {
      matchId: match.id,
      match: publicMatch(match, player.walletId),
      you: privateView(match, player.walletId),
    });
  }
  if (match.status === "finished") void settleMatch(match);
  void saveMatchSnapshot(
    match.id,
    match.status,
    publicState,
    match.status === "finished" ? (match.winners[0]?.walletId ?? null) : null,
  ).catch((error) => console.warn("[db] snapshot", error));
}

export async function playAction(
  matchId: string,
  walletId: string,
  input: ActionInput,
) {
  const match = matches.get(matchId);
  if (!match) throw new Error("Match not found");
  trackAction(match, walletId, input);
  recordAction(match, walletId, input);
  applyAction(match, walletId, input);
  await logMatchEvent(match.id, input.type, walletId, input).catch((error) =>
    console.warn("[db] event", (error as Error).message),
  );
  await broadcastMatch(match);
  return { match: publicMatch(match, walletId), you: privateView(match, walletId) };
}

export async function addChat(matchId: string, walletId: string, text: string) {
  const match = matches.get(matchId);
  if (!match) throw new Error("Match not found");
  if (!match.players.some((player) => player.walletId === walletId)) {
    throw new Error("Not seated");
  }
  const clean = text.trim().slice(0, 180);
  if (!clean) throw new Error("Empty message");
  const name = seatLabel(walletId);
  const message = { name, text: clean, at: Date.now() };
  const list = chats.get(matchId) ?? [];
  list.push(message);
  chats.set(matchId, list.slice(-40));
  await publish(`table:${matchId}`, "chat", message);
  return list;
}

export async function refreshSeatName(walletId: string) {
  const match = walletMatch(walletId);
  if (match) await broadcastMatch(match);
}

export function getChat(matchId: string) {
  return chats.get(matchId) ?? [];
}

function tick() {
  for (const match of matches.values()) {
    if (match.status !== "playing") continue;
    driveAi(match, async (walletId, input) => {
      trackAction(match, walletId, input);
      recordAction(match, walletId, input);
      applyAction(match, walletId, input);
      await broadcastMatch(match);
    });

    if (match.runoutAt && Date.now() >= match.runoutAt) {
      try {
        if (stepRunout(match)) void broadcastMatch(match);
      } catch (error) {
        console.warn("[engine] runout", error);
      }
      continue;
    }

    if (
      match.street === "showdown" &&
      match.showdownAt &&
      Date.now() - match.showdownAt >= SHOWDOWN_MS
    ) {
      continueAfterShowdown(match);
      void broadcastMatch(match);
      continue;
    }

    if (
      match.actionDeadline &&
      match.actionIndex !== null &&
      Date.now() >= match.actionDeadline
    ) {
      try {
        const actor = match.players[match.actionIndex]!;
        const timeout = { type: match.currentBet - actor.bet > 0 ? "fold" : "check" } as const;
        trackAction(match, actor.walletId, timeout);
        recordAction(match, actor.walletId, timeout);
        timeoutAct(match);
        void broadcastMatch(match);
      } catch (error) {
        console.warn("[engine] timeout", error);
      }
    }
  }
}

setInterval(tick, 250);

export function listMatches() {
  return [...matches.values()].map((match) => ({
    id: match.id,
    mode: match.mode,
    status: match.status,
    players: match.players.length,
  }));
}
