import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

/**
 * SerpApi (Google results as JSON) with a small, disk-backed cache and daily budget, because the
 * free plan is 250 searches a month and dev restarts would otherwise spend fresh searches.
 * Key: SERPAPI_KEY in server/.env.
 */
export const SERPAPI = {
  /** Coach web searches per day across all players (free plan: ~6/day + news ~2/day ≈ 240/month). */
  coachSearchesPerDay: Number(process.env.SERPAPI_COACH_PER_DAY ?? 6),
  /** How long an identical coach query reuses its results. */
  queryCacheMs: 6 * 60 * 60_000,
  /** How often the news strip refreshes. */
  newsRefreshMs: 12 * 60 * 60_000,
};

/** On Vercel the code folder is read-only; only /tmp is writable (and per instance). */
const defaultDir = process.env.VERCEL
  ? pathToFileURL(`${tmpdir()}/horns-cache/`)
  : new URL("../.cache/", import.meta.url);

/** Tiny JSON file store under server/.cache (git-ignored), or /tmp on Vercel. */
export class DiskCache<T> {
  private readonly file: URL;
  constructor(name: string, dir = defaultDir) {
    this.file = new URL(`${name}.json`, dir);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Cache is best-effort: without a writable folder, reads miss and writes are dropped.
    }
  }
  read(): T | null {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as T;
    } catch {
      return null;
    }
  }
  write(value: T) {
    try {
      writeFileSync(this.file, JSON.stringify(value));
    } catch {
      // Cache is best-effort.
    }
  }
}

export async function serpapi(params: Record<string, string>, apiKey: string, fetchImpl: typeof fetch = fetch) {
  const url = new URL("https://serpapi.com/search");
  for (const [k, v] of Object.entries({ ...params, api_key: apiKey })) url.searchParams.set(k, v);
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`SerpApi ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as Record<string, unknown> & { error?: string };
  if (data.error) throw new Error(`SerpApi: ${data.error}`);
  return data;
}

export type WebResult = { title: string; link: string; source: string; snippet: string };

type SearchState = { day: string; used: number; queries: Record<string, { at: number; results: WebResult[] }> };

/** Google web search for the coach, with a per-day budget and per-query cache that survive restarts. */
export class CoachSearch {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly store: DiskCache<SearchState>;
  private state: SearchState;

  constructor(apiKey: string, options: { fetchImpl?: typeof fetch; cache?: DiskCache<SearchState> } = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.store = options.cache ?? new DiskCache<SearchState>("coach-search");
    this.state = this.store.read() ?? { day: "", used: 0, queries: {} };
  }

  private today() {
    const day = new Date().toISOString().slice(0, 10);
    if (this.state.day !== day) {
      const fresh = Object.fromEntries(Object.entries(this.state.queries).filter(([, q]) => Date.now() - q.at < SERPAPI.queryCacheMs));
      this.state = { day, used: 0, queries: fresh };
    }
  }

  /** Results for a query, or null when today's budget is spent. */
  async search(query: string): Promise<WebResult[] | null> {
    this.today();
    const key = query.trim().toLowerCase().replace(/\s+/g, " ");
    const cached = this.state.queries[key];
    if (cached && Date.now() - cached.at < SERPAPI.queryCacheMs) return cached.results;
    if (this.state.used >= SERPAPI.coachSearchesPerDay) return null;

    this.state.used++;
    this.store.write(this.state);
    let data: Record<string, unknown>;
    try {
      data = await serpapi({ engine: "google", q: query, num: "5", gl: "us", hl: "en" }, this.apiKey, this.fetchImpl);
    } catch (e) {
      this.state.used--; // SerpApi doesn't bill failed searches, so neither do we
      this.store.write(this.state);
      throw e;
    }
    const organic = (data.organic_results ?? []) as { title?: string; link?: string; source?: string; snippet?: string }[];
    const results = organic
      .filter(r => r.title && r.link)
      .slice(0, 4)
      .map(r => ({ title: r.title!, link: r.link!, source: r.source ?? new URL(r.link!).hostname.replace(/^www\./, ""), snippet: (r.snippet ?? "").slice(0, 300) }));
    this.state.queries[key] = { at: Date.now(), results };
    this.store.write(this.state);
    return results;
  }
}
