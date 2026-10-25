import type { IncomingMessage, ServerResponse } from "node:http";
import { DiskCache, SERPAPI, serpapi } from "./serpapi.ts";

export type NewsItem = { title: string; link: string; source: string; date: string };
type NewsState = { updatedAt: number; items: NewsItem[] };

/** Tournament and pro news only. */
export const NEWS_QUERY = '(WSOP OR WPT OR EPT OR "World Series of Poker" OR "poker tournament" OR "poker pro") when:7d';

/** The site is play-money only: skip casino, sportsbook and real-money promo stories. */
const PROMO = /casino|sportsbook|betting|\bbet\b|bonus|promo|deposit|slots?\b|sweepstake|free spins|real[- ]money|odds boost|crypto casino|gambling site|best .* sites/i;

export function cleanNews(raw: { title?: string; link?: string; source?: { name?: string }; iso_date?: string; date?: string }[]): NewsItem[] {
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  for (const r of raw) {
    const title = r.title?.trim();
    const source = r.source?.name?.trim() ?? "";
    if (!title || !r.link?.startsWith("https://")) continue;
    if (PROMO.test(title) || PROMO.test(source)) continue;
    const key = title.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ title, link: r.link, source, date: r.iso_date ?? r.date ?? "" });
    if (items.length === 10) break;
  }
  return items;
}

/**
 * Poker headlines for the landing-page ticker. Refreshed at most every 12 hours no matter how
 * many visitors (~60 searches a month); the cache survives restarts; a failed refresh keeps old news.
 */
export class NewsFeed {
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly store: DiskCache<NewsState>;
  private state: NewsState;
  private refreshing: Promise<void> | null = null;
  private readonly log: (msg: string) => void;

  constructor(apiKey: string | undefined, options: { fetchImpl?: typeof fetch; cache?: DiskCache<NewsState>; log?: (msg: string) => void } = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.store = options.cache ?? new DiskCache<NewsState>("news");
    this.state = this.store.read() ?? { updatedAt: 0, items: [] };
    this.log = options.log ?? (() => {});
  }

  async items(): Promise<NewsState> {
    const stale = Date.now() - this.state.updatedAt > SERPAPI.newsRefreshMs;
    if (stale && this.apiKey) {
      this.refreshing ??= this.refresh().finally(() => (this.refreshing = null));
      await this.refreshing;
    }
    return this.state;
  }

  private async refresh() {
    try {
      const data = await serpapi({ engine: "google_news", q: NEWS_QUERY, gl: "us", hl: "en" }, this.apiKey!, this.fetchImpl);
      const items = cleanNews((data.news_results ?? []) as Parameters<typeof cleanNews>[0]);
      this.state = { updatedAt: Date.now(), items: items.length ? items : this.state.items };
      this.store.write(this.state);
      this.log(`news refreshed: ${items.length} headlines`);
    } catch (e) {
      // Keep old headlines; try again in an hour rather than on every request.
      this.state = { ...this.state, updatedAt: Date.now() - SERPAPI.newsRefreshMs + 60 * 60_000 };
      this.log(`news refresh failed: ${(e as Error).message}`);
    }
  }
}

/** GET /api/news  ->  { items, updatedAt } */
export function newsHandler(feed: NewsFeed) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET") return res.writeHead(405).end();
    const { items, updatedAt } = await feed.items();
    res.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=600" }).end(JSON.stringify({ items, updatedAt }));
  };
}
