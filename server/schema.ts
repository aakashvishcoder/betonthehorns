import { query } from "./db.js";
import { cleanDisplayName, rememberName } from "./names.js";
import { MODES, type GameMode } from "./types.js";

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
  matchId?: string,
) {
  if (!MODES.includes(mode)) throw new Error("Invalid mode");
  await ensureWallet(walletId);
  await query(
    `INSERT INTO elo_history (wallet_id, mode, elo, match_id, source)
     VALUES ($1, $2, $3, $4, 'solana')`,
    [walletId, mode, elo, matchId ?? null],
  );
}

export async function insertMatch(id: string, mode: string, snapshot: unknown) {
  await query(
    `INSERT INTO matches (id, mode, status, snapshot) VALUES ($1, $2, 'playing', $3)`,
    [id, mode, snapshot],
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
