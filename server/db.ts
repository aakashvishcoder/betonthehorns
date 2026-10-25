import "dotenv/config";
import pg from "pg";

let pool: pg.Pool | null = null;

export function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is missing. Add it to .env");
  }
  pool = new pg.Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 8,
    // A serverless instance can be frozen mid-transaction (holding a table's row lock until it
    // wakes). Postgres ends such sessions after 10s so the lock is freed for everyone else.
    options: "-c idle_in_transaction_session_timeout=10000",
  });
  return pool;
}

/**
 * Runs `fn` while holding a Postgres advisory lock, so only one server instance at a time runs
 * the schema setup. (On Vercel several instances start together; racing DROP/CREATE TRIGGER
 * made one fail and fall back to in-memory games.)
 */
export async function withMigrationLock<T>(fn: () => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock(424242)");
    return await fn();
  } finally {
    await client.query("SELECT pg_advisory_unlock(424242)").catch(() => undefined);
    client.release();
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: unknown[],
) {
  return getPool().query<T>(text, values);
}
