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
 * Runs the schema setup in one server instance at a time. (On Vercel several instances start
 * together; racing DROP/CREATE TRIGGER made one fail and fall back to in-memory games.)
 * The lock is transaction-scoped and never waited on: an instance frozen while holding it loses
 * it after 10s (idle_in_transaction_session_timeout); the others don't block, they wait up to
 * ~12s for `done()` and then carry on (the tables already exist).
 */
export async function withMigrationLock(fn: () => Promise<void>, done: () => Promise<boolean>) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ got: boolean }>("SELECT pg_try_advisory_xact_lock(424242) AS got");
    if (rows[0]?.got) {
      await fn();
      await client.query("COMMIT");
      return;
    }
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  for (let i = 0; i < 24 && !(await done()); i++) await new Promise((r) => setTimeout(r, 500));
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: unknown[],
) {
  return getPool().query<T>(text, values);
}
