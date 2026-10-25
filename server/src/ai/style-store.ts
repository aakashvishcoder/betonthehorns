import type { Mode } from "../matchmaker.ts";
import { type SnowflakeAuth, snowflakeHeaders, snowflakeHost } from "./cortex.ts";
import { type GameStats, type Style, styleFromStats } from "./style.ts";

export type GameRow = GameStats & { wallet: string; mode: Mode; ranked: boolean; place: number; players: number };

/** Where per-game style counters go, and where a player's style is read back from. */
export interface StyleStore {
  /** One row per player per finished game (AI seats are excluded by the caller). */
  record(rows: GameRow[]): Promise<void>;
  /** The player's style over recent games, or null if they have no history. */
  styleOf(wallet: string): Promise<Style | null>;
}

/** In-memory store for tests and the offline prototype. */
export class MemoryStyleStore implements StyleStore {
  readonly rows: GameRow[] = [];
  async record(rows: GameRow[]) {
    this.rows.push(...rows);
  }
  async styleOf(wallet: string) {
    return styleFromStats(this.rows.filter(r => r.wallet === wallet));
  }
}

const COLUMNS = ["WALLET", "MODE", "RANKED", "HANDS", "VPIP", "PFR", "AGGRESSIVE", "PASSIVE", "SAW_FLOP", "SHOWDOWNS", "SHOWDOWNS_WON", "PLACE", "PLAYERS"];

/**
 * Snowflake via the SQL API. Writes are one multi-row INSERT per finished game and reads are
 * cached, so the extra-small warehouse wakes about once per game (billed ~60 s each time).
 * Tables come from server/snowflake/setup.sql.
 */
export class SnowflakeStyleStore implements StyleStore {
  private readonly auth: SnowflakeAuth;
  private readonly target: { warehouse: string; database: string; schema: string; role: string };
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, { style: Style | null; at: number }>();
  static readonly CACHE_MS = 10 * 60_000;

  constructor(auth: SnowflakeAuth, fetchImpl: typeof fetch = fetch) {
    this.auth = auth;
    this.fetchImpl = fetchImpl;
    this.target = {
      warehouse: process.env.SNOWFLAKE_WAREHOUSE ?? "HORNS_WH",
      database: process.env.SNOWFLAKE_DATABASE ?? "HORNS",
      schema: process.env.SNOWFLAKE_SCHEMA ?? "POKER",
      role: process.env.SNOWFLAKE_ROLE ?? "HORNS_APP",
    };
  }

  private async sql(statement: string, values: (string | number | boolean)[]) {
    const bindings = Object.fromEntries(
      values.map((v, i) => [
        String(i + 1),
        { type: typeof v === "number" ? "FIXED" : typeof v === "boolean" ? "BOOLEAN" : "TEXT", value: String(v) },
      ]),
    );
    const res = await this.fetchImpl(`${snowflakeHost(this.auth.account)}/api/v2/statements`, {
      method: "POST",
      headers: snowflakeHeaders(this.auth),
      body: JSON.stringify({ statement, timeout: 30, bindings, ...this.target }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`Snowflake SQL ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as { data?: (string | null)[][] };
  }

  async record(rows: GameRow[]) {
    if (!rows.length) return;
    const placeholders = rows.map(() => `(${COLUMNS.map(() => "?").join(", ")})`).join(", ");
    const values = rows.flatMap(r => [
      r.wallet, r.mode, r.ranked, r.hands, r.vpip, r.pfr, r.aggressive, r.passive, r.sawFlop, r.showdowns, r.showdownsWon, r.place, r.players,
    ]);
    await this.sql(`INSERT INTO PLAYER_GAME_STATS (${COLUMNS.join(", ")}) VALUES ${placeholders}`, values);
    for (const r of rows) this.cache.delete(r.wallet);
  }

  async styleOf(wallet: string) {
    const cached = this.cache.get(wallet);
    if (cached && Date.now() - cached.at < SnowflakeStyleStore.CACHE_MS) return cached.style;
    const result = await this.sql("SELECT HANDS, VPIP, PFR, AGGRESSION FROM PLAYER_STYLE WHERE WALLET = ?", [wallet]);
    const row = result.data?.[0];
    const style = row && Number(row[0]) > 0
      ? { hands: Number(row[0]), vpip: Number(row[1]), pfr: Number(row[2]), aggression: Number(row[3] ?? 1) }
      : null;
    this.cache.set(wallet, { style, at: Date.now() });
    return style;
  }
}
