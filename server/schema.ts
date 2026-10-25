import { pool, query } from "./db.js";
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

  await tryHypertable("elo_history");
  await tryHypertable("match_events");

  await query(`
    CREATE INDEX IF NOT EXISTS elo_history_wallet_mode_time
      ON elo_history (wallet_id, mode, time DESC);
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS match_events_match_time
      ON match_events (match_id, time DESC);
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
  const client = await pool.connect();
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
        `INSERT INTO elo_locks (match_id, wallet_id, mode, stake) VALUES ($1, $2, $3, $4)`,
        [matchId, seat.walletId, mode, seat.stake],
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
  const result = await query<{ wallet_id: string; stake: number }>(
    `SELECT wallet_id, stake FROM elo_locks WHERE match_id = $1`,
    [matchId],
  );
  return new Map(result.rows.map((row) => [row.wallet_id, row.stake]));
}

/** Give back stakes whose table died before settlement, such as a server restart. */
export async function refundOpenEscrows() {
  if (!dbReady) return;
  const open = await query<{ match_id: string; wallet_id: string; mode: GameMode; stake: number }>(
    `SELECT match_id, wallet_id, mode, stake FROM elo_locks WHERE settled = FALSE`,
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
    stats: stats.rows,
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
         finished_at = CASE WHEN $2 = 'finished' THEN NOW() ELSE finished_at END
     WHERE id = $1`,
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
