import {
  claimQueueSeats,
  currentElos,
  dbReady,
  enqueueSeat,
  ensureWallet,
  findPlayingMatchId,
  insertMatch,
  insertMatchPlayers,
  listLiveMatches,
  listQueue,
  loadChat,
  loadLiveMatchRow,
  lockEscrow,
  logMatchEvent,
  recordChainTxs,
  removeQueuedWallet,
  restoreQueueSeats,
  saveChatLine,
  saveLiveMatch,
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

function isLiveMatch(value: unknown): value is MatchState {
  if (!value || typeof value !== "object") return false;
  const match = value as MatchState;
  return (
    typeof match.id === "string" &&
    typeof match.seed === "string" &&
    Array.isArray(match.players) &&
    (match.status === "playing" || match.status === "finished")
  );
}

function rememberMatch(match: MatchState) {
  matches.set(match.id, match);
  for (const player of match.players) {
    if (!player.bot) byWallet.set(player.walletId, match.id);
  }
}

async function hydrateMatch(id: string) {
  const cached = matches.get(id);
  if (cached) return cached;
  const row = await loadLiveMatchRow(id);
  if (!isLiveMatch(row)) return undefined;
  if (!chats.has(id)) chats.set(id, await loadChat(id));
  rememberMatch(row);
  return row;
}

export async function hydrateLiveMatches() {
  for (const row of await listLiveMatches()) {
    if (!isLiveMatch(row.live_state)) continue;
    if (!chats.has(row.id)) chats.set(row.id, await loadChat(row.id));
    rememberMatch(row.live_state);
  }
  if (matches.size > 0) {
    console.log(`[table] restored ${matches.size} live match${matches.size === 1 ? "" : "es"}`);
  }
}

export async function walletMatch(walletId: string) {
  const id = byWallet.get(walletId) ?? (await findPlayingMatchId(walletId));
  return id ? hydrateMatch(id) : undefined;
}

export async function getMatch(id: string) {
  return hydrateMatch(id);
}

export async function queueSnapshot(mode: GameMode) {
  const waiting = dbReady ? await listQueue(mode) : queueOf(mode);
  return {
    mode,
    seats: MODE_SEATS[mode],
    count: waiting.length,
    wallets: waiting.map((seat) => seat.walletId),
  };
}

const joining = new Map<string, Promise<{
  status: "queued" | "playing";
  matchId: string | null;
  queue: Awaited<ReturnType<typeof queueSnapshot>>;
}>>();

export async function joinQueue(walletId: string, mode: GameMode) {
  const pending = joining.get(walletId);
  if (pending) return pending;
  const work = joinQueueOnce(walletId, mode);
  joining.set(walletId, work);
  try {
    return await work;
  } finally {
    joining.delete(walletId);
  }
}

async function joinQueueOnce(walletId: string, mode: GameMode) {
  const existing = await walletMatch(walletId);
  if (existing && existing.status === "playing") {
    return { status: "playing" as const, matchId: existing.id, queue: await queueSnapshot(mode) };
  }
  if (existing && existing.status === "finished") {
    byWallet.delete(walletId);
  }

  await ensureWallet(walletId).catch((error) =>
    console.warn("[db] ensure wallet", (error as Error).message),
  );
  if (dbReady) {
    await enqueueSeat(walletId, mode);
    leaveAllQueues(walletId);
  } else {
    leaveAllQueues(walletId);
    queueOf(mode).push({ walletId, joinedAt: Date.now() });
  }
  await publishQueue(mode);
  const started = await tryMatch(mode);
  if (started) {
    return { status: "playing" as const, matchId: started.id, queue: await queueSnapshot(mode) };
  }
  return { status: "queued" as const, matchId: null, queue: await queueSnapshot(mode) };
}

export async function leaveQueue(walletId: string) {
  if (dbReady) {
    const mode = await removeQueuedWallet(walletId);
    if (mode) await publishQueue(mode);
  }
  for (const mode of MODES) {
    const list = queueOf(mode);
    const next = list.filter((seat) => seat.walletId !== walletId);
    if (next.length !== list.length) {
      queues.set(mode, next);
      if (!dbReady) await publishQueue(mode);
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
  let walletIds: string[];
  if (dbReady) {
    const claimed = await claimQueueSeats(mode, need);
    if (!claimed) return null;
    walletIds = claimed;
  } else {
    const waiting = queueOf(mode);
    if (waiting.length < need) return null;
    const taken = waiting.splice(0, need);
    queues.set(mode, waiting);
    walletIds = taken.map((seat) => seat.walletId);
  }
  const match = createMatch(mode, walletIds);
  rememberMatch(match);
  chats.set(match.id, []);

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
    await saveLiveMatch(match.id, match).catch((error) =>
      console.warn("[db] live", (error as Error).message),
    );
  } catch (error) {
    matches.delete(match.id);
    chats.delete(match.id);
    for (const walletId of wallets) byWallet.delete(walletId);
    if (dbReady) await restoreQueueSeats(mode, walletIds);
    else queueOf(mode).unshift(...walletIds.map((walletId) => ({ walletId, joinedAt: Date.now() })));
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

async function publishQueue(mode: GameMode) {
  await publish(`queue:${mode}`, "waiting", await queueSnapshot(mode));
}

export async function broadcastMatch(match: MatchState, name = "state") {
  match.revision += 1;
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
  void saveLiveMatch(match.id, match).catch((error) =>
    console.warn("[db] live", (error as Error).message),
  );
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
  const match = await hydrateMatch(matchId);
  if (!match) throw new Error("Match not found");
  applyAction(match, walletId, input);
  await logMatchEvent(match.id, input.type, walletId, input).catch((error) =>
    console.warn("[db] event", (error as Error).message),
  );
  await broadcastMatch(match);
  return { match: publicMatch(match, walletId), you: privateView(match, walletId) };
}

export async function addChat(matchId: string, walletId: string, text: string) {
  const match = await hydrateMatch(matchId);
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
  await saveChatLine(matchId, message).catch((error) =>
    console.warn("[db] chat", (error as Error).message),
  );
  await publish(`table:${matchId}`, "chat", message);
  return list;
}

export async function refreshSeatName(walletId: string) {
  const match = await walletMatch(walletId);
  if (match) await broadcastMatch(match);
}

export async function getChat(matchId: string) {
  const cached = chats.get(matchId);
  if (cached) return cached;
  const loaded = await loadChat(matchId);
  chats.set(matchId, loaded);
  return loaded;
}

function tick() {
  for (const match of matches.values()) {
    if (match.status !== "playing") continue;

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
