import {
  claimQueueSeats,
  closeLiveMatch,
  matchAlreadySettled,
  currentElos,
  dbReady,
  enqueueSeat,
  ensureWallet,
  findPlayingMatchId,
  insertMatch,
  insertMatchPlayers,
  listLeftoverPlayingIds,
  listQueue,
  loadChat,
  loadLiveMatchRow,
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
import { getPool } from "./db.js";
import { recordAction, saveHistory, syncHistory } from "./history.js";
import {
  aiToAct,
  decideAi,
  finishTracking,
  practiceSeats,
  refundPracticeGame,
  takePracticeGame,
} from "./practice.js";
import { claimFinalize, releaseSeats, reserveSeats, seatedAt } from "./seats.js";
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

const LIVE_MS = 45 * 60 * 1000;
const ABANDON_GRACE_MS = 90 * 1000;

function isLiveMatch(value: unknown): value is MatchState {
  if (!value || typeof value !== "object") return false;
  const match = value as MatchState;
  return (
    typeof match.id === "string" &&
    typeof match.seed === "string" &&
    Array.isArray(match.players) &&
    match.status === "playing"
  );
}

function rememberMatch(match: MatchState) {
  matches.set(match.id, match);
  for (const player of match.players) {
    if (!player.bot) byWallet.set(player.walletId, match.id);
  }
}

function isFresh(match: MatchState) {
  return Date.now() - match.startedAt < LIVE_MS;
}

/** How long a player can be away (turns timing out) before they forfeit. */
export const AWAY_MS = 5 * 60 * 1000;

function awayOf(match: MatchState, walletId: string) {
  match.away ??= {};
  return (match.away[walletId] ??= { lastActed: match.startedAt, timeouts: 0 });
}

/** Call whenever a human acts themselves: they're back, the timeout streak resets. */
function markActed(match: MatchState, walletId: string) {
  const away = awayOf(match, walletId);
  away.lastActed = Date.now();
  away.timeouts = 0;
}

/**
 * Over: too old, or every human still in it has been away longer than AWAY_MS (nobody is left
 * to keep the table moving). One player being away just times out until they forfeit.
 */
function isAbandoned(match: MatchState) {
  if (match.status !== "playing" || !isFresh(match)) return true;
  const humans = match.players.filter((p) => !p.bot && !p.busted && !match.forfeited?.includes(p.walletId));
  if (humans.length === 0) return true;
  const now = Date.now();
  return humans.every((p) => now - awayOf(match, p.walletId).lastActed > AWAY_MS + ABANDON_GRACE_MS);
}

function dueStep(match: MatchState) {
  const now = Date.now();
  if (match.runoutAt && now >= match.runoutAt) return "runout" as const;
  if (
    match.street === "showdown" &&
    match.showdownAt &&
    now - match.showdownAt >= SHOWDOWN_MS
  ) {
    return "showdown" as const;
  }
  if (match.actionDeadline && match.actionIndex !== null && now >= match.actionDeadline) {
    return "timeout" as const;
  }
  return null;
}

function applyDueStep(match: MatchState) {
  const step = dueStep(match);
  if (step === "runout") {
    try {
      return stepRunout(match);
    } catch (error) {
      console.warn("[engine] runout", error);
      return false;
    }
  }
  if (step === "showdown") {
    // Forfeited players' chips leave the game between hands, so they bust out here.
    for (const player of match.players) {
      if (match.forfeited?.includes(player.walletId) && !player.busted) player.stack = 0;
    }
    continueAfterShowdown(match);
    return true;
  }
  if (step === "timeout") {
    try {
      const actor = match.players[match.actionIndex!]!;
      const input = { type: match.currentBet - actor.bet > 0 ? "fold" : "check" } as const;
      recordAction(match, actor.walletId, input);
      if (!actor.bot) {
        const away = awayOf(match, actor.walletId);
        away.timeouts += 1;
        if (away.timeouts >= 2 && Date.now() - away.lastActed > AWAY_MS && !match.forfeited?.includes(actor.walletId)) {
          (match.forfeited ??= []).push(actor.walletId);
          match.log.push(`${seatLabel(actor.walletId)} was away too long and forfeits`);
        }
      }
      timeoutAct(match);
      match.lastActionAt = Date.now();
      return true;
    } catch (error) {
      console.warn("[engine] timeout", error);
      return false;
    }
  }
  return false;
}

async function takeLiveMatch(id: string) {
  // With a database, the row is the truth: another instance may have finished this game.
  const cached = matches.get(id);
  if (!dbReady && cached?.status === "playing") return cached;
  const row = await loadLiveMatchRow(id);
  if (!isLiveMatch(row) || !isFresh(row) || isAbandoned(row)) return undefined;
  if (!chats.has(id)) chats.set(id, await loadChat(id));
  rememberMatch(row);
  return row;
}

async function closeLeftover(id: string) {
  matches.delete(id);
  chats.delete(id);
  await releaseSeats(id).catch((error) => console.warn("[seats] release", (error as Error).message));
  const settled = await matchAlreadySettled(id);
  if (!settled) {
    await refundMatchLocks(id).catch((error) =>
      console.warn("[elo] leftover", (error as Error).message),
    );
  }
  await closeLiveMatch(id).catch((error) =>
    console.warn("[db] leftover", (error as Error).message),
  );
}

export async function hydrateLiveMatches() {
  const leftover = await listLeftoverPlayingIds();
  let closed = 0;
  for (const id of leftover) {
    const row = await loadLiveMatchRow(id);
    if (isLiveMatch(row) && isFresh(row) && !isAbandoned(row)) continue;
    await closeLeftover(id);
    closed += 1;
  }
  if (closed > 0) {
    console.log(`[table] closed ${closed} leftover match${closed === 1 ? "" : "es"}`);
  }
}

export async function walletMatch(walletId: string) {
  const id = dbReady
    ? ((await seatedAt(walletId)) ?? (await findPlayingMatchId(walletId)))
    : byWallet.get(walletId);
  if (!id) return undefined;
  const live = await takeLiveMatch(id);
  if (live?.status === "playing") return live;
  const row = await loadLiveMatchRow(id);
  if (isLiveMatch(row) && isAbandoned(row)) await closeLeftover(id);
  return undefined;
}

export async function getMatch(id: string) {
  return takeLiveMatch(id);
}

export async function getMatchView(id: string, walletId?: string) {
  const row = await loadMatchView(id);
  if (row?.status === "finished") {
    if (!row.snapshot || typeof row.snapshot !== "object") return null;
    const snapshot = { ...(row.snapshot as ReturnType<typeof publicMatch>) };
    snapshot.status = "finished";
    snapshot.actionIndex = null;
    snapshot.actionDeadline = null;
    if (row.reveal_seed && !snapshot.revealSeed) snapshot.revealSeed = row.reveal_seed;
    matches.delete(id);
    byWallet.forEach((matchId, wallet) => {
      if (matchId === id) byWallet.delete(wallet);
    });
    return {
      match: snapshot,
      you: null,
      chat: await loadChat(id),
    };
  }
  const live = (await advanceMatch(id)) ?? matches.get(id);
  // Includes the poll whose step just finished the game: show that, not the older snapshot.
  if (live && (live.status === "playing" || live.revision >= ((row?.snapshot as { revision?: number } | null)?.revision ?? 0))) {
    return {
      match: publicMatch(live, walletId),
      you: walletId ? privateView(live, walletId) : null,
      chat: await getChat(id),
    };
  }
  if (!row?.snapshot || typeof row.snapshot !== "object") return null;
  return {
    match: row.snapshot as ReturnType<typeof publicMatch>,
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

/** Thrown when someone with a live game tries to queue or start practice: send them back to it. */
function alreadyPlaying(matchId: string) {
  return Object.assign(new Error("You're already in a game. Returning you to your table."), { status: 409, matchId });
}

async function joinQueueOnce(walletId: string, mode: GameMode) {
  const current = await walletMatch(walletId);
  if (current) throw alreadyPlaying(current.id);
  byWallet.delete(walletId);
  const leftover = await findPlayingMatchId(walletId);
  if (leftover) await closeLeftover(leftover);

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
  await pullGlobalQueue(mode);
  if (pinned.length && dbReady) {
    for (const walletId of pinned) {
      await enqueueSeat(walletId, mode).catch(() => undefined);
    }
  }
  const sitting = dbReady ? await playingWalletIds() : new Set(byWallet.keys());
  const need = MODE_SEATS[mode];
  let walletIds: string[];
  if (dbReady) {
    const waiting = (await listQueue(mode)).map((seat) => seat.walletId).filter((id) => !sitting.has(id));
    if (waiting.length < need) return null;
    const claimed = await claimQueueSeats(mode, need, waiting);
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
  // The database decides: if any of them got seated elsewhere meanwhile, put the rest back.
  const seats = await reserveSeats(match.id, walletIds);
  if (!seats.ok) {
    const free = walletIds.filter((id) => !seats.busy.includes(id));
    if (dbReady) await restoreQueueSeats(mode, free);
    else queueOf(mode).unshift(...free.map((walletId) => ({ walletId, joinedAt: Date.now() })));
    return null;
  }
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
    await releaseSeats(match.id).catch(() => undefined);
    if (dbReady) await restoreQueueSeats(mode, walletIds);
    else queueOf(mode).unshift(...walletIds.map((walletId) => ({ walletId, joinedAt: Date.now() })));
    console.warn("[elo] lock", (error as Error).message);
    return null;
  }

  void import("./chain.js").then(({ lockMatch }) => lockMatch({
    matchId: match.id,
    mode: match.mode,
    commitHash: match.commitHash,
    wallets,
    stakes: stakes.map((seat) => seat.stake),
  })).then(async (txs) => {
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
  const existing = await walletMatch(walletId);
  if (existing) return { matchId: existing.id };
  if (!takePracticeGame(walletId)) {
    throw Object.assign(new Error("You've played today's AI practice games. Come back tomorrow!"), { status: 429 });
  }
  try {
    if (dbReady) await removeQueuedWallet(walletId);
    leaveAllQueues(walletId);
    const elo = (await currentElos([walletId], mode).catch(() => new Map<string, number>())).get(walletId) ?? STARTING_ELO;
    const { ids, ai } = await practiceSeats(walletId, mode, MODE_SEATS[mode], elo);
    const match = createMatch(mode, [walletId], ids, { ranked: false });
    match.ai = ai;
    match.lastActionAt = Date.now();
    const seats = await reserveSeats(match.id, [walletId]);
    if (!seats.ok) {
      refundPracticeGame(walletId);
      const live = await walletMatch(walletId);
      if (live) return { matchId: live.id };
      throw Object.assign(new Error("Couldn't start practice. Try again."), { status: 409 });
    }
    rememberMatch(match);
    chats.set(match.id, []);
    await insertMatch(match.id, match.mode, publicMatch(match), match.commitHash).catch((error) =>
      console.warn("[db] persist practice", (error as Error).message),
    );
    await insertMatchPlayers(
      match.id,
      match.players.map((player) => ({ walletId: player.walletId, seat: player.seat, bot: player.bot })),
    ).catch((error) => console.warn("[db] practice players", (error as Error).message));
    await broadcastMatch(match, "matched");
    return { matchId: match.id };
  } catch (error) {
    refundPracticeGame(walletId);
    throw error;
  }
}

/** End-of-game work, once per match across instances: Elo, hand history, style data, seats. */
/**
 * End-of-game work. Awaited by the request that finished the game: on Vercel anything left
 * running after the response is frozen, which used to leave seats held ("Return to table" on a
 * finished game) and hand histories unsaved (Analyze had no hands). Seats and history are safe
 * to repeat, so they run before the once-only claim; Elo and style stats run once.
 */
async function finalizeOnce(match: MatchState) {
  for (const player of match.players) if (byWallet.get(player.walletId) === match.id) byWallet.delete(player.walletId);
  await releaseSeats(match.id).catch((error) => console.warn("[seats] release", (error as Error).message));
  await saveHistory(match).catch((error) => console.warn("[history] save", (error as Error).message));
  if (!(await claimFinalize(match.id).catch(() => false))) return;
  await import("./settle.js")
    .then(({ settleMatch }) => settleMatch(match))
    .catch((error) => console.warn("[elo] settle", (error as Error).message));
  await finishTracking(match);
}

async function publishQueue(mode: GameMode) {
  await publish(`queue:${mode}`, "waiting", await queueSnapshot(mode));
}

async function fanoutMatch(match: MatchState, name = "state") {
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
  if (match.status === "finished") await finalizeOnce(match);
  void saveMatchSnapshot(
    match.id,
    match.status,
    publicState,
    match.status === "finished" ? (match.winners[0]?.walletId ?? null) : null,
  ).catch((error) => console.warn("[db] snapshot", error));
}

export async function broadcastMatch(match: MatchState, name = "state") {
  syncHistory(match);
  match.revision += 1;
  void saveLiveMatch(match.id, match).catch((error) =>
    console.warn("[db] live", (error as Error).message),
  );
  await fanoutMatch(match, name);
}

const thinking = new Set<string>();

/** If an AI seat is due to act, decide its move (outside any lock: Cortex can take seconds). */
async function planAi(match: unknown) {
  if (!isLiveMatch(match)) return null;
  const walletId = aiToAct(match);
  if (!walletId) return null;
  const key = `${match.id}:${match.revision}`;
  if (thinking.has(key)) return null;
  thinking.add(key);
  try {
    return { revision: match.revision, walletId, input: await decideAi(match, walletId) };
  } catch (error) {
    console.warn("[ai] decide", (error as Error).message);
    return null;
  } finally {
    setTimeout(() => thinking.delete(key), 30_000).unref();
  }
}

type Move = { walletId: string; input: ActionInput };

/** Applies one move (human or AI) to the match, recording it for history and away tracking. */
function applyMove(match: MatchState, { walletId, input }: Move) {
  recordAction(match, walletId, input);
  try {
    applyAction(match, walletId, input);
  } catch (error) {
    match.history?.at(-1)?.actions.pop();
    throw error;
  }
  const player = match.players.find((p) => p.walletId === walletId);
  if (player && !player.bot) markActed(match, walletId);
  match.lastActionAt = Date.now();
}

/**
 * Brings a live match up to date under a row lock: the given move (a player's action), a due AI
 * move, then any due timeout / run-out / showdown step. Every change to a live table goes
 * through here, so two serverless instances can never overwrite each other's moves.
 */
async function advanceMatch(id: string, move?: Move) {
  if (!dbReady) {
    const match = matches.get(id);
    if (!match || match.status !== "playing") return match;
    if (isAbandoned(match)) {
      await abandonOpenMatch(match.players.find((player) => !player.bot)?.walletId ?? "");
      return undefined;
    }
    let changed = false;
    if (move) {
      applyMove(match, move);
      changed = true;
    } else {
      const plan = await planAi(match);
      if (plan && plan.revision === match.revision && match.players[match.actionIndex ?? -1]?.walletId === plan.walletId) {
        applyMove(match, plan);
        changed = true;
      }
    }
    if (applyDueStep(match)) changed = true;
    if (changed) await broadcastMatch(match);
    return match;
  }

  // Practice tables: peek first so an AI move can be decided before taking the lock.
  const plan = !move && matches.get(id)?.ai ? await planAi(await loadLiveMatchRow(id)) : null;

  const client = await getPool().connect();
  let changed = false;
  let match: MatchState | undefined;
  try {
    await client.query("BEGIN");
    // Never queue behind a stuck lock for long: a refresh falls back to reading, a move retries.
    await client.query("SET LOCAL lock_timeout = '8s'");
    const locked = await client.query<{ live_state: unknown }>(
      `SELECT live_state FROM matches WHERE id = $1 AND status = 'playing' FOR UPDATE`,
      [id],
    );
    const row = locked.rows[0]?.live_state;
    if (!isLiveMatch(row) || !isFresh(row)) {
      await client.query("ROLLBACK");
      if (row) await closeLeftover(id);
      return undefined;
    }
    if (isAbandoned(row)) {
      await client.query("ROLLBACK");
      await closeLeftover(id);
      return undefined;
    }
    match = row;
    if (move) {
      applyMove(match, move); // throws (and rolls back) on an illegal move
      changed = true;
    } else if (plan && plan.revision === match.revision && match.players[match.actionIndex ?? -1]?.walletId === plan.walletId) {
      try {
        applyMove(match, plan);
        changed = true;
      } catch (error) {
        console.warn("[ai] move", (error as Error).message);
      }
    }
    if (applyDueStep(match)) changed = true;
    if (changed) {
      syncHistory(match);
      match.revision = (match.revision ?? 0) + 1;
      await client.query(
        `UPDATE matches
         SET live_state = CASE WHEN $3 = 'finished' THEN NULL ELSE $2::jsonb END,
             status = CASE WHEN $3 = 'finished' THEN 'finished' ELSE status END,
             finished_at = CASE WHEN $3 = 'finished' THEN COALESCE(finished_at, NOW()) ELSE finished_at END
         WHERE id = $1`,
        [id, match, match.status],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (move && (error as { code?: string }).code === "55P03") {
      throw new Error("The table is busy. Try that again.");
    }
    if (move) throw error;
    console.warn("[table] advance", (error as Error).message);
    return takeLiveMatch(id);
  } finally {
    client.release();
  }

  if (!match) return undefined;
  rememberMatch(match);
  if (!chats.has(id)) chats.set(id, await loadChat(id));
  if (changed) await fanoutMatch(match);
  return match;
}

export async function playAction(
  matchId: string,
  walletId: string,
  input: ActionInput,
) {
  const row = await loadMatchView(matchId);
  if (row?.status === "finished") throw new Error("Match is over");
  if (!dbReady && !matches.has(matchId)) await takeLiveMatch(matchId);
  const match = await advanceMatch(matchId, { walletId, input });
  if (!match) throw new Error("Match is over");
  await logMatchEvent(match.id, input.type, walletId, input).catch((error) =>
    console.warn("[db] event", (error as Error).message),
  );
  return { match: publicMatch(match, walletId), you: privateView(match, walletId) };
}

export async function addChat(matchId: string, walletId: string, text: string) {
  const match = await takeLiveMatch(matchId);
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
    void advanceMatch(match.id).finally(() => ticking.delete(match.id));
  }
}

export function pulse() {
  tick();
}

// Background timers only on a long-running server (local, Vultr). On Vercel an instance is
// frozen after each response, and a timer caught mid-transaction held a table's lock for ~20s;
// there, tables advance on every player request and the 2-second table refresh instead.
if (!process.env.VERCEL) {
  setInterval(tick, 250);
  setInterval(() => {
    void Promise.all(MODES.map((mode) => publishQueue(mode))).catch((error) =>
      console.warn("[queue]", (error as Error).message),
    );
  }, 5000);
}

export function listMatches() {
  return [...matches.values()].map((match) => ({
    id: match.id,
    mode: match.mode,
    status: match.status,
    players: match.players.length,
  }));
}
