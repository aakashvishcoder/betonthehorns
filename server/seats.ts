import { query } from "./db.js";
import { dbReady } from "./schema.js";

/**
 * One live game per wallet, enforced by the database so racing serverless instances can't seat
 * the same wallet twice (wallet_games has the wallet as its primary key). A row exists from the
 * moment a table is created until it finishes or is closed. Without a database it falls back to
 * memory (single local server).
 */
const memory = new Map<string, string>(); // wallet -> match

export async function migrateSeats() {
  await query(`
    CREATE TABLE IF NOT EXISTS wallet_games (
      wallet_id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wallet_games_match ON wallet_games (match_id);
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
    ALTER TABLE queue_seats ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    DELETE FROM wallet_games w
    WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.id = w.match_id AND m.status = 'playing')
      AND w.created_at < NOW() - INTERVAL '2 minutes';
  `);
}

/**
 * Seats these wallets at `matchId`. All or nothing: if any of them already has a live game,
 * nothing is reserved and the ones that were busy are returned.
 */
export async function reserveSeats(matchId: string, wallets: string[]): Promise<{ ok: true } | { ok: false; busy: string[] }> {
  if (!dbReady) {
    const busy = wallets.filter((w) => memory.has(w));
    if (busy.length) return { ok: false, busy };
    for (const w of wallets) memory.set(w, matchId);
    return { ok: true };
  }
  // Clear leftover seats from games that already finished, so they can't block a new one.
  await query(
    `DELETE FROM wallet_games w USING matches m
     WHERE w.wallet_id = ANY($1::text[]) AND m.id = w.match_id AND m.status <> 'playing'`,
    [wallets],
  );
  const result = await query<{ wallet_id: string }>(
    `INSERT INTO wallet_games (wallet_id, match_id)
     SELECT unnest($1::text[]), $2
     ON CONFLICT (wallet_id) DO NOTHING
     RETURNING wallet_id`,
    [wallets, matchId],
  );
  const got = new Set(result.rows.map((r) => r.wallet_id));
  if (got.size === wallets.length) return { ok: true };
  await query(`DELETE FROM wallet_games WHERE match_id = $1`, [matchId]);
  return { ok: false, busy: wallets.filter((w) => !got.has(w)) };
}

export async function releaseSeats(matchId: string) {
  if (!dbReady) {
    for (const [w, m] of memory) if (m === matchId) memory.delete(w);
    return;
  }
  await query(`DELETE FROM wallet_games WHERE match_id = $1`, [matchId]);
}

/** The wallet's live game id, if it has one. */
export async function seatedAt(walletId: string): Promise<string | null> {
  if (!dbReady) return memory.get(walletId) ?? null;
  // A seat at a game that has finished (its release never ran) doesn't count.
  const result = await query<{ match_id: string }>(
    `SELECT w.match_id FROM wallet_games w JOIN matches m ON m.id = w.match_id
     WHERE w.wallet_id = $1 AND m.status = 'playing'`,
    [walletId],
  );
  return result.rows[0]?.match_id ?? null;
}

const finalizedHere = new Set<string>();

/** True for exactly one caller per match (across instances): it does the end-of-game work. */
export async function claimFinalize(matchId: string) {
  if (finalizedHere.has(matchId)) return false;
  finalizedHere.add(matchId);
  if (!dbReady) return true;
  const result = await query(
    `UPDATE matches SET finalized_at = NOW() WHERE id = $1 AND finalized_at IS NULL RETURNING id`,
    [matchId],
  );
  return (result.rowCount ?? 0) > 0;
}
