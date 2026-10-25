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

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: unknown[],
) {
  return getPool().query<T>(text, values);
}
