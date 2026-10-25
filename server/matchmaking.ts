import {
  claimQueueSeats,
  clearQueueSeats,
  closeLiveMatch,
  currentElos,
  dbReady,
  enqueueSeat,
  ensureWallet,
  findPlayingMatchId,
  insertMatch,
  insertMatchPlayers,
  keepQueueSeats,
  listLeftoverPlayingIds,
  listQueue,
  loadChat,
  loadMatchView,
  lockEscrow,
  logMatchEvent,
  playingWalletIds,
  recordChainTxs,
  refundMatchLocks,
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
import { listQueuePresence, publish } from "./ably.js";
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

function rememberMatch(match: MatchState) {
  matches.set(match.id, match);
  for (const player of match.players) {
    if (!player.bot) byWallet.set(player.walletId, match.id);
  }
}

export async function hydrateLiveMatches() {
  await clearQueueSeats().catch((error) =>
    console.warn("[queue] clear", (error as Error).message),
  );
  const leftover = await listLeftoverPlayingIds();
  for (const id of leftover) {
    await refundMatchLocks(id).catch((error) =>
      console.warn("[elo] leftover", (error as Error).message),
    );
    await closeLiveMatch(id).catch((error) =>
      console.warn("[db] leftover", (error as Error).message),
    );
  }
  if (leftover.length > 0) {
    console.log(`[table] closed ${leftover.length} leftover match${leftover.length === 1 ? "" : "es"}`);
  }
}

export async function walletMatch(walletId: string) {
  const id = byWallet.get(walletId);
  const match = id ? matches.get(id) : undefined;
  return match?.status === "playing" ? match : undefined;
}

export async function getMatch(id: string) {
  return matches.get(id);
}

export async function getMatchView(id: string, walletId?: string) {
  const live = matches.get(id);
  if (live) {
    return {
      match: publicMatch(live, walletId),
      you: walletId ? privateView(live, walletId) : null,
      chat: await getChat(id),
    };
  }
  const row = await loadMatchView(id);
  if (!row?.snapshot || typeof row.snapshot !== "object") return null;
  const snapshot = row.snapshot as ReturnType<typeof publicMatch>;
  if (row.status === "finished" && row.reveal_seed && !snapshot.revealSeed) {
    snapshot.revealSeed = row.reveal_seed;
  }
  return {
    match: snapshot,
    you: null,
    chat: await loadChat(id),
  };
}

function mergeSeats(...lists: QueueSeat[][]) {
  const seats = new Map<string, number>();
  for (const list of lists) {
    for (const seat of list) {
      if (!seats.has(seat.walletId)) seats.set(seat.walletId, seat.joinedAt);
    }
  }
  return [...seats.entries()]
    .map(([walletId, joinedAt]) => ({ walletId, joinedAt }))
    .sort((left, right) => left.joinedAt - right.joinedAt);
}

export async function pullGlobalQueue(mode: GameMode) {
  const present = await listQueuePresence(mode);
  const sitting = dbReady ? await playingWalletIds() : new Set(byWallet.keys());
  const waiting: QueueSeat[] = [];
  for (const seat of present) {
    if (sitting.has(seat.walletId)) continue;
    waiting.push(seat);
    if (dbReady) {
      await enqueueSeat(seat.walletId, mode).catch((error) =>
        console.warn("[queue] sync", (error as Error).message),
      );
    } else if (!queueOf(mode).some((row) => row.walletId === seat.walletId)) {
      queueOf(mode).push(seat);
    }
  }
  return waiting;
}

export async function queueSnapshot(mode: GameMode) {
  const sitting = dbReady ? await playingWalletIds() : new Set(byWallet.keys());
  const waiting = mergeSeats(
    dbReady ? await listQueue(mode) : queueOf(mode),
    await listQueuePresence(mode),
  ).filter((seat) => !sitting.has(seat.walletId));
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

async function abandonOpenMatch(walletId: string) {
  const existing = await walletMatch(walletId);
  if (!existing || existing.status !== "playing") return;
  for (const player of existing.players) {
    if (!player.bot) byWallet.delete(player.walletId);
  }
  matches.delete(existing.id);
  chats.delete(existing.id);
  existing.status = "finished";
  existing.street = "complete";
  await refundMatchLocks(existing.id).catch((error) =>
    console.warn("[elo] abandon", (error as Error).message),
  );
  await closeLiveMatch(existing.id).catch((error) =>
    console.warn("[db] abandon", (error as Error).message),
  );
  const publicState = publicMatch(existing);
  await publish(`table:${existing.id}`, "state", publicState);
  for (const player of existing.players) {
    if (player.bot) continue;
    await publish(`wallet:${player.walletId}`, "state", {
      matchId: existing.id,
      match: publicMatch(existing, player.walletId),
      you: privateView(existing, player.walletId),
    });
  }
}

async function joinQueueOnce(walletId: string, mode: GameMode) {
  const existing = await walletMatch(walletId);
  if (existing?.status === "playing") {
    return { status: "playing" as const, matchId: existing.id, queue: await queueSnapshot(mode) };
  }
  const leftover = await findPlayingMatchId(walletId);
  if (leftover) {
    await refundMatchLocks(leftover).catch((error) =>
      console.warn("[elo] leftover", (error as Error).message),
    );
    await closeLiveMatch(leftover).catch((error) =>
      console.warn("[db] leftover", (error as Error).message),
    );
  }
  await abandonOpenMatch(walletId);
  byWallet.delete(walletId);

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
  const started = await tryMatch(mode, [walletId]);
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

async function tryMatch(mode: GameMode, pinned: string[] = []) {
  const present = await pullGlobalQueue(mode);
  const allowed = [...new Set([...present.map((seat) => seat.walletId), ...pinned])];
  if (dbReady) await keepQueueSeats(mode, allowed);
  else {
    queues.set(
      mode,
      queueOf(mode).filter((seat) => allowed.includes(seat.walletId)),
    );
  }
  const need = MODE_SEATS[mode];
  let walletIds: string[];
  if (dbReady) {
    const claimed = await claimQueueSeats(mode, need, allowed);
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
  await publish(`queue:${mode}`, "waiting", await queueSnapshot(mode));
}

const tracked = new Set<string>();

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
  const match = matches.get(matchId);
  if (!match || match.status !== "playing") throw new Error("Match not found");
  applyAction(match, walletId, input);
  await logMatchEvent(match.id, input.type, walletId, input).catch((error) =>
    console.warn("[db] event", (error as Error).message),
  );
  await broadcastMatch(match);
  return { match: publicMatch(match, walletId), you: privateView(match, walletId) };
}

export async function addChat(matchId: string, walletId: string, text: string) {
  const match = matches.get(matchId);
  if (!match || match.status !== "playing") throw new Error("Match not found");
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

const ticking = new Set<string>();

function tick() {
  for (const match of matches.values()) {
    if (match.status !== "playing" || ticking.has(match.id)) continue;

    ticking.add(match.id);
    try {
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
    } finally {
      ticking.delete(match.id);
    }
  }
}

setInterval(tick, 250);

setInterval(() => {
  void Promise.all(MODES.map((mode) => publishQueue(mode))).catch((error) =>
    console.warn("[queue]", (error as Error).message),
  );
}, 5000);

export function listMatches() {
  return [...matches.values()].map((match) => ({
    id: match.id,
    mode: match.mode,
    status: match.status,
    players: match.players.length,
  }));
}
