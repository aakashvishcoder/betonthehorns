import { getPool, query } from "./db.js";
import { STARTING_ELO } from "./elo.js";
import { cleanDisplayName, rememberName } from "./names.js";
import { MODES, type ChainTx, type GameMode } from "./types.js";

export let dbReady = false;

export async function migrate() {
  try {
    await query(`
    CREATE TABLE IF NOT EXISTS wallets (
      wallet_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`ALTER TABLE wallets ADD COLUMN IF NOT EXISTS display_name TEXT`);

  await query(`
    CREATE TABLE IF NOT EXISTS player_stats (
      wallet_id TEXT NOT NULL REFERENCES wallets(wallet_id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK (mode IN ('hands-up', 'sng-4', 'sng-6')),
      elo INTEGER NOT NULL DEFAULT 1200,
      games INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      hands INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (wallet_id, mode)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS elo_locks (
      match_id TEXT NOT NULL,
      wallet_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('hands-up', 'sng-4', 'sng-6')),
      stake INTEGER NOT NULL,
      settled BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (match_id, wallet_id)
    );
  `);
  await query(`ALTER TABLE elo_locks ADD COLUMN IF NOT EXISTS pre_elo INTEGER`);
  await query(`
    CREATE TABLE IF NOT EXISTS showcase (
      wallet_id TEXT NOT NULL REFERENCES wallets(wallet_id) ON DELETE CASCADE,
      badge_key TEXT NOT NULL,
      shown BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY (wallet_id, badge_key)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS elo_history (
      time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      wallet_id TEXT NOT NULL REFERENCES wallets(wallet_id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK (mode IN ('hands-up', 'sng-4', 'sng-6')),
      elo INTEGER NOT NULL,
      match_id TEXT,
      source TEXT NOT NULL DEFAULT 'pending_solana'
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      winner_wallet_id TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      snapshot JSONB
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS match_players (
      match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      wallet_id TEXT NOT NULL,
      seat INTEGER NOT NULL,
      bot BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (match_id, wallet_id)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS match_events (
      time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      match_id TEXT NOT NULL,
      wallet_id TEXT,
      event TEXT NOT NULL,
      payload JSONB
    );
  `);

  await query(`ALTER TABLE elo_history ADD COLUMN IF NOT EXISTS delta INTEGER NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS commit_hash TEXT`);
  await query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS reveal_seed TEXT`);
  await query(`
    CREATE TABLE IF NOT EXISTS match_chain (
      time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      match_id TEXT NOT NULL,
      label TEXT NOT NULL,
      signature TEXT NOT NULL,
      PRIMARY KEY (signature)
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS elo_history_wallet_mode_time
      ON elo_history (wallet_id, mode, time DESC);
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS match_events_match_time
      ON match_events (match_id, time DESC);
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS queue_seats (
      wallet_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK (mode IN ('hands-up', 'sng-4', 'sng-6')),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS queue_seats_mode_joined
      ON queue_seats (mode, joined_at);
  `);
  await query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS live_state JSONB`);
  await query(`
    CREATE TABLE IF NOT EXISTS match_chat (
      match_id TEXT NOT NULL,
      at BIGINT NOT NULL,
      name TEXT NOT NULL,
      text TEXT NOT NULL
    );
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS match_chat_match_at
      ON match_chat (match_id, at);
  `);
    await query(`
      CREATE OR REPLACE FUNCTION prevent_reopen_match()
      RETURNS trigger AS $$
      BEGIN
        IF OLD.status = 'finished' AND NEW.status = 'playing' THEN
          NEW.status := 'finished';
          NEW.live_state := NULL;
          NEW.finished_at := COALESCE(OLD.finished_at, NOW());
          IF NEW.snapshot IS NOT NULL THEN
            NEW.snapshot := jsonb_set(NEW.snapshot, '{status}', '"finished"');
          END IF;
        END IF;
        IF OLD.status = 'finished' THEN
          NEW.live_state := NULL;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await query(`DROP TRIGGER IF EXISTS matches_no_reopen ON matches`);
    await query(`
      CREATE TRIGGER matches_no_reopen
      BEFORE UPDATE ON matches
      FOR EACH ROW EXECUTE FUNCTION prevent_reopen_match();
    `);
    dbReady = true;
    console.log("[db] Timescale schema ready");
  } catch (error) {
    dbReady = false;
    console.warn(
      "[db] Timescale is not connected. Matchmaking still runs in memory.",
      (error as Error).message,
    );
  }
}

async function tryHypertable(table: "elo_history" | "match_events") {
  try {
    await query(
      `SELECT create_hypertable('${table}', 'time', if_not_exists => TRUE)`,
    );
  } catch (error) {
    console.warn(`[db] hypertable ${table}:`, (error as Error).message);
  }
}

export async function enqueueSeat(walletId: string, mode: GameMode) {
  await query(
    `INSERT INTO queue_seats (wallet_id, mode, joined_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (wallet_id) DO UPDATE
     SET mode = EXCLUDED.mode,
         joined_at = CASE
           WHEN queue_seats.mode = EXCLUDED.mode THEN queue_seats.joined_at
           ELSE NOW()
         END`,
    [walletId, mode],
  );
}

export async function listQueue(mode: GameMode) {
  const result = await query<{ wallet_id: string; joined_at: Date }>(
    `SELECT wallet_id, joined_at FROM queue_seats WHERE mode = $1 ORDER BY joined_at`,
    [mode],
  );
  return result.rows.map((row) => ({
    walletId: row.wallet_id,
    joinedAt: new Date(row.joined_at).getTime(),
  }));
}

export async function removeQueuedWallet(walletId: string) {
  const result = await query<{ mode: GameMode }>(
    `DELETE FROM queue_seats WHERE wallet_id = $1 RETURNING mode`,
    [walletId],
  );
  return result.rows[0]?.mode ?? null;
}

export async function keepQueueSeats(mode: GameMode, keep: string[]) {
  if (keep.length === 0) {
    await query(`DELETE FROM queue_seats WHERE mode = $1`, [mode]);
    return;
  }
  await query(
    `DELETE FROM queue_seats WHERE mode = $1 AND NOT (wallet_id = ANY($2::text[]))`,
    [mode, keep],
  );
}

export async function playingWalletIds() {
  if (!dbReady) return new Set<string>();
  // wallet_games (seats.ts) covers practice tables too, and is written before match_players.
  const result = await query<{ wallet_id: string }>(
    `SELECT w.wallet_id FROM wallet_games w JOIN matches m ON m.id = w.match_id AND m.status = 'playing'
     UNION
     SELECT p.wallet_id
     FROM match_players p
     JOIN matches m ON m.id = p.match_id
     WHERE m.status = 'playing'`,
  );
  return new Set(result.rows.map((row) => row.wallet_id));
}

/** Takes the oldest seats, or leaves the queue untouched when it is short. */
export async function claimQueueSeats(mode: GameMode, need: number, allowed?: string[]) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const listed = await client.query<{ wallet_id: string }>(
      `SELECT wallet_id FROM queue_seats
       WHERE mode = $1
       ORDER BY joined_at
       FOR UPDATE`,
      [mode],
    );
    const poolSeats = allowed
      ? listed.rows.filter((row) => allowed.includes(row.wallet_id))
      : listed.rows;
    if (poolSeats.length < need) {
      await client.query("COMMIT");
      return null;
    }
    const taken = poolSeats.slice(0, need).map((row) => row.wallet_id);
    await client.query(`DELETE FROM queue_seats WHERE wallet_id = ANY($1::text[])`, [taken]);
    await client.query("COMMIT");
    return taken;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function restoreQueueSeats(mode: GameMode, walletIds: string[]) {
  for (const [index, walletId] of walletIds.entries()) {
    await query(
      `INSERT INTO queue_seats (wallet_id, mode, joined_at)
       VALUES ($1, $2, TO_TIMESTAMP($3))
       ON CONFLICT (wallet_id) DO UPDATE
       SET mode = EXCLUDED.mode, joined_at = EXCLUDED.joined_at`,
      [walletId, mode, index / 1000],
    );
  }
}

export async function ensureWallet(walletId: string) {
  await query(
    `INSERT INTO wallets (wallet_id) VALUES ($1) ON CONFLICT (wallet_id) DO NOTHING`,
    [walletId],
  );
  const named = await query<{ display_name: string | null }>(
    `SELECT display_name FROM wallets WHERE wallet_id = $1`,
    [walletId],
  );
  rememberName(walletId, named.rows[0]?.display_name ?? null);
}

export async function setDisplayName(walletId: string, raw: string) {
  const name = cleanDisplayName(raw);
  await ensureWallet(walletId);
  await query(`UPDATE wallets SET display_name = $2 WHERE wallet_id = $1`, [
    walletId,
    name,
  ]);
  rememberName(walletId, name);
  return name;
}

export type EloPoint = { time: string; elo: number; matchId: string | null };

export async function getWalletRecord(walletId: string) {
  await ensureWallet(walletId);
  const result = await query<{
    time: Date;
    mode: GameMode;
    elo: number;
    match_id: string | null;
  }>(
    `SELECT time, mode, elo, match_id
     FROM elo_history
     WHERE wallet_id = $1
     ORDER BY time ASC`,
    [walletId],
  );

  const eloHistory: Record<GameMode, EloPoint[]> = {
    "hands-up": [],
    "sng-4": [],
    "sng-6": [],
  };
  for (const row of result.rows) {
    eloHistory[row.mode].push({
      time: row.time.toISOString(),
      elo: row.elo,
      matchId: row.match_id,
    });
  }

  const named = await query<{ display_name: string | null }>(
    `SELECT display_name FROM wallets WHERE wallet_id = $1`,
    [walletId],
  );
  const displayName = named.rows[0]?.display_name ?? null;
  rememberName(walletId, displayName);

  return { walletId, displayName, eloHistory };
}

/** Reserved for Solana-confirmed ELO writes. Do not call from matchmaking. */
export async function appendEloHistory(
  walletId: string,
  mode: GameMode,
  elo: number,
  matchId: string | null,
  delta: number,
) {
  if (!MODES.includes(mode)) throw new Error("Invalid mode");
  await ensureWallet(walletId);
  await query(
    `INSERT INTO elo_history (wallet_id, mode, elo, match_id, delta, source)
     VALUES ($1, $2, $3, $4, $5, 'settled')`,
    [walletId, mode, elo, matchId, delta],
  );
}

export async function availableElo(walletId: string, mode: GameMode) {
  if (!dbReady) return STARTING_ELO;
  await ensureWallet(walletId);
  const result = await query<{ elo: number }>(
    `SELECT elo FROM player_stats WHERE wallet_id = $1 AND mode = $2`,
    [walletId, mode],
  );
  return result.rows[0]?.elo ?? STARTING_ELO;
}

/** Pull each seat's at-risk ELO out of their rating as soon as the table exists. */
export async function lockEscrow(
  matchId: string,
  mode: GameMode,
  stakes: { walletId: string; stake: number }[],
) {
  if (!dbReady) return;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const seat of stakes) {
      await client.query(
        `INSERT INTO wallets (wallet_id) VALUES ($1) ON CONFLICT (wallet_id) DO NOTHING`,
        [seat.walletId],
      );
      await client.query(
        `INSERT INTO player_stats (wallet_id, mode, elo) VALUES ($1, $2, $3)
         ON CONFLICT (wallet_id, mode) DO NOTHING`,
        [seat.walletId, mode, STARTING_ELO],
      );
      const before = await client.query<{ elo: number }>(
        `SELECT elo FROM player_stats WHERE wallet_id = $1 AND mode = $2`,
        [seat.walletId, mode],
      );
      const preElo = before.rows[0]?.elo ?? STARTING_ELO;
      const updated = await client.query<{ elo: number }>(
        `UPDATE player_stats SET elo = elo - $3
         WHERE wallet_id = $1 AND mode = $2 AND elo >= $3
         RETURNING elo`,
        [seat.walletId, mode, seat.stake],
      );
      if ((updated.rowCount ?? 0) !== 1) {
        throw new Error(`Need ${seat.stake} ELO in this mode to sit down`);
      }
      await client.query(
        `INSERT INTO elo_locks (match_id, wallet_id, mode, stake, pre_elo)
         VALUES ($1, $2, $3, $4, $5)`,
        [matchId, seat.walletId, mode, seat.stake, preElo],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function escrowLocks(matchId: string) {
  const result = await query<{
    wallet_id: string;
    stake: number;
    pre_elo: number | null;
    settled: boolean;
  }>(
    `SELECT wallet_id, stake, pre_elo, settled FROM elo_locks WHERE match_id = $1`,
    [matchId],
  );
  return new Map(
    result.rows.map((row) => [
      row.wallet_id,
      {
        stake: row.stake,
        preElo: row.pre_elo,
        settled: row.settled,
      },
    ]),
  );
}

export async function matchAlreadySettled(matchId: string) {
  const result = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM elo_history WHERE match_id = $1`,
    [matchId],
  );
  return Number(result.rows[0]?.n ?? 0) > 0;
}

/** Give back stakes whose table is gone. A live table in live_state keeps its lock. */
export async function refundOpenEscrows() {
  if (!dbReady) return;
  const open = await query<{ match_id: string; wallet_id: string; mode: GameMode; stake: number }>(
    `SELECT l.match_id, l.wallet_id, l.mode, l.stake
     FROM elo_locks l
     LEFT JOIN matches m ON m.id = l.match_id
     WHERE l.settled = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM elo_history h WHERE h.match_id = l.match_id
       )
       AND (m.id IS NULL OR m.status <> 'playing' OR m.live_state IS NULL)`,
  );
  for (const lock of open.rows) {
    await query(
      `UPDATE player_stats SET elo = elo + $3 WHERE wallet_id = $1 AND mode = $2`,
      [lock.wallet_id, lock.mode, lock.stake],
    );
    await query(`DELETE FROM elo_locks WHERE match_id = $1 AND wallet_id = $2`, [
      lock.match_id,
      lock.wallet_id,
    ]);
  }
  if (open.rows.length > 0) {
    console.log(`[elo] returned ${open.rows.length} open escrow${open.rows.length === 1 ? "" : "s"}`);
  }
}

export async function currentElos(walletIds: string[], mode: GameMode) {
  if (walletIds.length === 0) return new Map<string, number>();
  const result = await query<{ wallet_id: string; elo: number }>(
    `SELECT wallet_id, elo FROM player_stats WHERE mode = $1 AND wallet_id = ANY($2::text[])`,
    [mode, walletIds],
  );
  const elos = new Map(walletIds.map((walletId) => [walletId, 1200]));
  for (const row of result.rows) elos.set(row.wallet_id, row.elo);
  return elos;
}

export async function applySettlement(input: {
  matchId: string;
  mode: GameMode;
  seed: string;
  hands: number;
  players: { walletId: string; elo: number; delta: number; won: boolean }[];
}) {
  if (await matchAlreadySettled(input.matchId)) return;
  await query(`UPDATE matches SET reveal_seed = $2 WHERE id = $1`, [
    input.matchId,
    input.seed,
  ]);
  for (const player of input.players) {
    await ensureWallet(player.walletId);
    const won = player.won ? 1 : 0;
    await query(
      `INSERT INTO player_stats (wallet_id, mode, elo, games, wins, hands)
       VALUES ($1, $2, $3, 1, $4, $5)
       ON CONFLICT (wallet_id, mode) DO UPDATE
       SET elo = EXCLUDED.elo,
           games = player_stats.games + 1,
           wins = player_stats.wins + EXCLUDED.wins,
           hands = player_stats.hands + EXCLUDED.hands`,
      [player.walletId, input.mode, player.elo, won, input.hands],
    );
    await appendEloHistory(
      player.walletId,
      input.mode,
      player.elo,
      input.matchId,
      player.delta,
    );
  }
  await query(`UPDATE elo_locks SET settled = TRUE WHERE match_id = $1`, [input.matchId]);
}

export async function getLeaderboard(mode: GameMode) {
  const result = await query<{
    wallet_id: string;
    display_name: string | null;
    elo: number;
    games: number;
    wins: number;
    previous: number | null;
  }>(
    `SELECT s.wallet_id, w.display_name, s.elo, s.games, s.wins,
            (
              SELECT h.elo FROM elo_history h
              WHERE h.wallet_id = s.wallet_id AND h.mode = s.mode
              ORDER BY h.time DESC
              OFFSET 1 LIMIT 1
            ) AS previous
     FROM player_stats s
     JOIN wallets w ON w.wallet_id = s.wallet_id
     WHERE s.mode = $1 AND s.games > 0
     ORDER BY s.elo DESC, s.wins DESC, s.wallet_id`,
    [mode],
  );
  return result.rows.map((row, index) => ({
    address: row.wallet_id,
    name: row.display_name,
    elo: row.elo,
    games: row.games,
    wins: row.wins,
    move: row.elo - (row.previous ?? 1200),
    place: index + 1,
  }));
}

export async function getProfile(walletId: string) {
  await ensureWallet(walletId);
  const named = await query<{ display_name: string | null }>(
    `SELECT display_name FROM wallets WHERE wallet_id = $1`,
    [walletId],
  );
  const stats = await query<{
    mode: GameMode;
    elo: number;
    games: number;
    wins: number;
    hands: number;
  }>(
    `SELECT mode, elo, games, wins, hands FROM player_stats WHERE wallet_id = $1`,
    [walletId],
  );
  const latest = await query<{ mode: GameMode; elo: number }>(
    `SELECT DISTINCT ON (mode) mode, elo
     FROM elo_history
     WHERE wallet_id = $1
     ORDER BY mode, time DESC`,
    [walletId],
  );
  const settledElo = new Map(latest.rows.map((row) => [row.mode, row.elo]));
  const shownStats = stats.rows.map((row) => ({
    ...row,
    elo: settledElo.get(row.mode) ?? row.elo,
  }));
  const history = await query<{
    time: Date;
    mode: GameMode;
    elo: number;
    delta: number;
    match_id: string | null;
  }>(
    `SELECT time, mode, elo, delta, match_id
     FROM elo_history WHERE wallet_id = $1
     ORDER BY time DESC LIMIT 20`,
    [walletId],
  );
  const shown = await query<{ badge_key: string; shown: boolean }>(
    `SELECT badge_key, shown FROM showcase WHERE wallet_id = $1`,
    [walletId],
  );
  return {
    displayName: named.rows[0]?.display_name ?? null,
    stats: shownStats,
    recent: await withMatchChain(
      history.rows.map((row) => ({
        time: row.time.toISOString(),
        mode: row.mode,
        elo: row.elo,
        delta: row.delta,
        matchId: row.match_id,
      })),
    ),
    showcase: new Map(shown.rows.map((row) => [row.badge_key, row.shown])),
  };
}

async function withMatchChain<T extends { matchId: string | null }>(rows: T[]) {
  const ids = [...new Set(rows.map((row) => row.matchId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) {
    return rows.map((row) => ({ ...row, commitHash: null, revealSeed: null, chain: [] as ChainTx[] }));
  }
  const matches = await query<{ id: string; commit_hash: string | null; reveal_seed: string | null }>(
    `SELECT id, commit_hash, reveal_seed FROM matches WHERE id = ANY($1::text[])`,
    [ids],
  );
  const txs = await query<{ match_id: string; label: string; signature: string }>(
    `SELECT match_id, label, signature FROM match_chain
     WHERE match_id = ANY($1::text[])
     ORDER BY time ASC`,
    [ids],
  );
  const byId = new Map(matches.rows.map((row) => [row.id, row]));
  const chainById = new Map<string, ChainTx[]>();
  for (const tx of txs.rows) {
    const list = chainById.get(tx.match_id) ?? [];
    list.push({ label: tx.label, signature: tx.signature });
    chainById.set(tx.match_id, list);
  }
  return rows.map((row) => {
    const match = row.matchId ? byId.get(row.matchId) : undefined;
    return {
      ...row,
      commitHash: match?.commit_hash ?? null,
      revealSeed: match?.reveal_seed ?? null,
      chain: row.matchId ? (chainById.get(row.matchId) ?? []) : [],
    };
  });
}

export async function recordChainTxs(matchId: string, txs: ChainTx[]) {
  for (const tx of txs) {
    await query(
      `INSERT INTO match_chain (match_id, label, signature)
       VALUES ($1, $2, $3)
       ON CONFLICT (signature) DO NOTHING`,
      [matchId, tx.label, tx.signature],
    );
  }
}

export async function setShowcase(
  walletId: string,
  entries: { key: string; shown: boolean }[],
) {
  await ensureWallet(walletId);
  for (const entry of entries) {
    await query(
      `INSERT INTO showcase (wallet_id, badge_key, shown)
       VALUES ($1, $2, $3)
       ON CONFLICT (wallet_id, badge_key) DO UPDATE SET shown = EXCLUDED.shown`,
      [walletId, entry.key, entry.shown],
    );
  }
}

export type ChatLine = { name: string; text: string; at: number };

export async function saveLiveMatch(id: string, live: unknown) {
  if (!dbReady) return;
  const status =
    live && typeof live === "object" && "status" in live && (live as { status?: string }).status === "finished"
      ? "finished"
      : "playing";
  await query(
    `UPDATE matches
     SET live_state = CASE WHEN $3 = 'finished' THEN NULL ELSE $2::jsonb END,
         status = CASE WHEN $3 = 'finished' THEN 'finished' ELSE status END,
         finished_at = CASE WHEN $3 = 'finished' THEN COALESCE(finished_at, NOW()) ELSE finished_at END
     WHERE id = $1
       AND (status <> 'finished' OR $3 = 'finished')`,
    [id, live, status],
  );
}

export async function loadLiveMatchRow(id: string) {
  if (!dbReady) return null;
  const result = await query<{ live_state: unknown }>(
    `SELECT live_state
     FROM matches
     WHERE id = $1 AND status = 'playing' AND live_state IS NOT NULL`,
    [id],
  );
  return result.rows[0]?.live_state ?? null;
}

export async function listLiveMatches() {
  if (!dbReady) return [];
  const result = await query<{ id: string; live_state: unknown }>(
    `SELECT id, live_state FROM matches WHERE status = 'playing' AND live_state IS NOT NULL`,
  );
  return result.rows;
}

export async function loadMatchView(id: string) {
  if (!dbReady) return null;
  const result = await query<{
    id: string;
    status: string;
    snapshot: unknown;
    live_state: unknown;
    reveal_seed: string | null;
  }>(
    `SELECT id, status, snapshot, live_state, reveal_seed FROM matches WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listLeftoverPlayingIds() {
  if (!dbReady) return [];
  const result = await query<{ id: string }>(
    `SELECT id FROM matches WHERE status = 'playing'`,
  );
  return result.rows.map((row) => row.id);
}

export async function clearQueueSeats() {
  if (!dbReady) return;
  await query(`DELETE FROM queue_seats`);
}

export async function refundMatchLocks(matchId: string) {
  if (!dbReady) return;
  if (await matchAlreadySettled(matchId)) return;
  const open = await query<{ wallet_id: string; mode: GameMode; stake: number }>(
    `SELECT wallet_id, mode, stake FROM elo_locks WHERE match_id = $1 AND settled = FALSE`,
    [matchId],
  );
  for (const lock of open.rows) {
    await query(`UPDATE player_stats SET elo = elo + $3 WHERE wallet_id = $1 AND mode = $2`, [
      lock.wallet_id,
      lock.mode,
      lock.stake,
    ]);
    await query(`DELETE FROM elo_locks WHERE match_id = $1 AND wallet_id = $2`, [
      matchId,
      lock.wallet_id,
    ]);
  }
}

export async function closeLiveMatch(matchId: string) {
  if (!dbReady) return;
  await query(
    `UPDATE matches
     SET status = 'finished',
         live_state = NULL,
         finished_at = COALESCE(finished_at, NOW()),
         snapshot = CASE
           WHEN snapshot IS NULL THEN snapshot
           ELSE jsonb_set(snapshot, '{status}', '"finished"')
         END
     WHERE id = $1`,
    [matchId],
  );
}

export async function findPlayingMatchId(walletId: string) {
  if (!dbReady) return null;
  const result = await query<{ id: string }>(
    `SELECT w.match_id AS id FROM wallet_games w JOIN matches m ON m.id = w.match_id AND m.status = 'playing'
     WHERE w.wallet_id = $1
     UNION ALL
     (SELECT m.id
      FROM matches m
      JOIN match_players p ON p.match_id = m.id
      WHERE p.wallet_id = $1 AND m.status = 'playing'
      ORDER BY m.started_at DESC
      LIMIT 1)
     LIMIT 1`,
    [walletId],
  );
  return result.rows[0]?.id ?? null;
}

export async function saveChatLine(matchId: string, message: ChatLine) {
  if (!dbReady) return;
  await query(
    `INSERT INTO match_chat (match_id, at, name, text) VALUES ($1, $2, $3, $4)`,
    [matchId, message.at, message.name, message.text],
  );
}

export async function loadChat(matchId: string) {
  if (!dbReady) return [];
  const result = await query<ChatLine>(
    `SELECT name, text, at FROM match_chat WHERE match_id = $1 ORDER BY at ASC`,
    [matchId],
  );
  return result.rows.slice(-40);
}

export async function insertMatch(
  id: string,
  mode: string,
  snapshot: unknown,
  commitHash: string,
) {
  await query(
    `INSERT INTO matches (id, mode, status, snapshot, commit_hash)
     VALUES ($1, $2, 'playing', $3, $4)`,
    [id, mode, snapshot, commitHash],
  );
}

export async function saveMatchSnapshot(
  id: string,
  status: string,
  snapshot: unknown,
  winnerWalletId?: string | null,
) {
  await query(
    `UPDATE matches
     SET status = $2,
         snapshot = $3,
         winner_wallet_id = COALESCE($4, winner_wallet_id),
         finished_at = CASE WHEN $2 = 'finished' THEN COALESCE(finished_at, NOW()) ELSE finished_at END
     WHERE id = $1
       AND (status <> 'finished' OR $2 = 'finished')`,
    [id, status, snapshot, winnerWalletId ?? null],
  );
}

export async function insertMatchPlayers(
  matchId: string,
  players: { walletId: string; seat: number; bot: boolean }[],
) {
  for (const player of players) {
    if (!player.bot) await ensureWallet(player.walletId);
    await query(
      `INSERT INTO match_players (match_id, wallet_id, seat, bot)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [matchId, player.walletId, player.seat, player.bot],
    );
  }
}

/** Rebuild ratings from each unique match delta so leftover refunds cannot stack. */
export async function rebuildRatingsFromHistory() {
  if (!dbReady) return;
  const rows = await query<{
    wallet_id: string;
    mode: GameMode;
    match_id: string | null;
    delta: number;
    time: Date;
  }>(
    `SELECT wallet_id, mode, match_id, delta, time
     FROM elo_history
     WHERE source = 'settled'
     ORDER BY time ASC`,
  );
  const seen = new Set<string>();
  const running = new Map<string, number>();
  for (const row of rows.rows) {
    const matchKey = `${row.wallet_id}:${row.mode}:${row.match_id ?? row.time.toISOString()}`;
    if (seen.has(matchKey)) continue;
    seen.add(matchKey);
    const key = `${row.wallet_id}:${row.mode}`;
    const next = Math.max(0, (running.get(key) ?? STARTING_ELO) + row.delta);
    running.set(key, next);
    await query(
      `UPDATE elo_history
       SET elo = $4
       WHERE wallet_id = $1 AND mode = $2 AND match_id IS NOT DISTINCT FROM $3`,
      [row.wallet_id, row.mode, row.match_id, next],
    );
  }
  for (const [key, elo] of running) {
    const [walletId, mode] = key.split(":");
    await query(`UPDATE player_stats SET elo = $3 WHERE wallet_id = $1 AND mode = $2`, [
      walletId,
      mode,
      elo,
    ]);
  }
  if (running.size > 0) {
    console.log(`[elo] rebuilt ${running.size} rating${running.size === 1 ? "" : "s"} from match history`);
  }
}

export async function logMatchEvent(
  matchId: string,
  event: string,
  walletId?: string | null,
  payload?: unknown,
) {
  await query(
    `INSERT INTO match_events (match_id, wallet_id, event, payload)
     VALUES ($1, $2, $3, $4)`,
    [matchId, walletId ?? null, event, payload ?? null],
  );
}
