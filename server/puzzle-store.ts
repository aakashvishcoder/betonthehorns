import { query } from "./db.js";
import { dbReady } from "./schema.js";

/**
 * Daily puzzle results per wallet: one try per puzzle, streaks, and the day's leaderboard.
 * Uses Postgres (puzzle_attempts) when connected, otherwise memory (lost on restart).
 */
export type Attempt = { index: number; choice: string; correct: boolean };

const memory = new Map<string, Map<number, Attempt & { at: number }>>(); // `${wallet}|${day}`

export async function migratePuzzles() {
  await query(`
    CREATE TABLE IF NOT EXISTS puzzle_attempts (
      wallet_id TEXT NOT NULL,
      day DATE NOT NULL,
      idx INTEGER NOT NULL,
      choice TEXT NOT NULL,
      correct BOOLEAN NOT NULL,
      time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (wallet_id, day, idx)
    );
  `);
}

/** Records an answer; returns false if this wallet already answered this puzzle (one try). */
export async function saveAttempt(walletId: string, day: string, attempt: Attempt): Promise<boolean> {
  if (dbReady) {
    const result = await query(
      `INSERT INTO puzzle_attempts (wallet_id, day, idx, choice, correct) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [walletId, day, attempt.index, attempt.choice, attempt.correct],
    );
    return (result.rowCount ?? 0) > 0;
  }
  const key = `${walletId}|${day}`;
  const day_ = memory.get(key) ?? new Map();
  if (day_.has(attempt.index)) return false;
  day_.set(attempt.index, { ...attempt, at: Date.now() });
  memory.set(key, day_);
  return true;
}

export async function attemptsFor(walletId: string, day: string): Promise<Attempt[]> {
  if (dbReady) {
    const result = await query<{ idx: number; choice: string; correct: boolean }>(
      `SELECT idx, choice, correct FROM puzzle_attempts WHERE wallet_id = $1 AND day = $2 ORDER BY idx`,
      [walletId, day],
    );
    return result.rows.map((r) => ({ index: r.idx, choice: r.choice, correct: r.correct }));
  }
  return [...(memory.get(`${walletId}|${day}`)?.values() ?? [])].map(({ index, choice, correct }) => ({ index, choice, correct }));
}

const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * Days in a row with all five puzzles answered, counting back from today
 * (or from yesterday if today isn't finished yet, so a streak doesn't vanish at midnight).
 */
export async function streakFor(walletId: string, today: string, perDay = 5): Promise<number> {
  let complete: Set<string>;
  if (dbReady) {
    const result = await query<{ day: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day FROM puzzle_attempts WHERE wallet_id = $1
       GROUP BY day HAVING COUNT(*) >= $2`,
      [walletId, perDay],
    );
    complete = new Set(result.rows.map((r) => r.day));
  } else {
    complete = new Set(
      [...memory.entries()].filter(([k, v]) => k.startsWith(`${walletId}|`) && v.size >= perDay).map(([k]) => k.split("|")[1]!),
    );
  }
  let day = complete.has(today) ? today : dayBefore(today);
  let streak = 0;
  while (complete.has(day)) {
    streak++;
    day = dayBefore(day);
  }
  return streak;
}

/** The day's best scores: most correct, then whoever finished first. */
export async function leaderboard(day: string, limit = 20): Promise<{ walletId: string; correct: number; answered: number }[]> {
  if (dbReady) {
    const result = await query<{ wallet_id: string; correct: string; answered: string }>(
      `SELECT wallet_id, COUNT(*) FILTER (WHERE correct) AS correct, COUNT(*) AS answered, MAX(time) AS last
       FROM puzzle_attempts WHERE day = $1
       GROUP BY wallet_id ORDER BY correct DESC, answered DESC, last ASC LIMIT $2`,
      [day, limit],
    );
    return result.rows.map((r) => ({ walletId: r.wallet_id, correct: Number(r.correct), answered: Number(r.answered) }));
  }
  return [...memory.entries()]
    .filter(([k]) => k.endsWith(`|${day}`))
    .map(([k, v]) => {
      const list = [...v.values()];
      return { walletId: k.split("|")[0]!, correct: list.filter((a) => a.correct).length, answered: list.length, last: Math.max(...list.map((a) => a.at)) };
    })
    .sort((a, b) => b.correct - a.correct || b.answered - a.answered || a.last - b.last)
    .slice(0, limit)
    .map(({ walletId, correct, answered }) => ({ walletId, correct, answered }));
}
