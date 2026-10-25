import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { askCoach } from "./coach.ts";
import { NewsFeed, cleanNews } from "./news.ts";
import { CoachSearch, DiskCache, SERPAPI } from "./serpapi.ts";

const tempDir = () => pathToFileURL(mkdtempSync(`${tmpdir()}/horns-cache-`) + "/");

const story = (title: string, source = "PokerNews", link = `https://example.com/${encodeURIComponent(title)}`) => ({
  title,
  link,
  source: { name: source },
  iso_date: "2026-10-24T10:00:00Z",
});

test("news filter drops casino/betting promos and duplicates", () => {
  const items = cleanNews([
    story("WSOP Main Event final table set"),
    story("WSOP Main Event final table set"), // duplicate
    story("Best online casino bonus codes this week"),
    story("EPT Barcelona: day 2 recap", "Sportsbook Daily"),
    story("Phil Ivey returns to high-stakes poker"),
    story("Form 8.5 (EPT/RI)-Advanced Medical Solutions Group plc", "Yahoo Finance"),
    story("Seminole Hard Rock Hollywood Poker", "Seminole Hard Rock Hollywood Poker"),
    story("Local council meeting recap", "Daily News"), // not about poker
    { title: "No link", source: { name: "x" } },
    story("Insecure link", "PokerNews", "http://example.com/x"),
  ]);
  assert.deepEqual(items.map(i => i.title), ["WSOP Main Event final table set", "Phil Ivey returns to high-stakes poker"]);
});

test("news feed refreshes at most every 12 hours, survives restarts, keeps old news on failure", async () => {
  const dir = tempDir();
  let calls = 0;
  let fail = false;
  const fake: typeof fetch = async url => {
    calls++;
    assert.equal(new URL(String(url)).searchParams.get("engine"), "google_news");
    if (fail) return new Response("boom", { status: 500 });
    return Response.json({ news_results: [story("WPT World Championship begins")] });
  };
  const feed = new NewsFeed("key", { fetchImpl: fake, cache: new DiskCache("news", dir) });
  assert.equal((await feed.items()).items.length, 1);
  await Promise.all([feed.items(), feed.items(), feed.items()]);
  assert.equal(calls, 1, "served from cache");

  const restarted = new NewsFeed("key", { fetchImpl: fake, cache: new DiskCache("news", dir) });
  assert.equal((await restarted.items()).items[0]!.title, "WPT World Championship begins");
  assert.equal(calls, 1, "a restart reuses the disk cache");

  // Force staleness, then fail: old headlines stay.
  const cache = new DiskCache<{ updatedAt: number; items: unknown[] }>("news", dir);
  cache.write({ ...cache.read()!, updatedAt: Date.now() - SERPAPI.newsRefreshMs - 1 });
  fail = true;
  const stale = new NewsFeed("key", { fetchImpl: fake, cache: new DiskCache("news", dir) });
  assert.equal((await stale.items()).items.length, 1);
  assert.equal(calls, 2);
  await stale.items();
  assert.equal(calls, 2, "a failed refresh waits before retrying");

  assert.deepEqual((await new NewsFeed(undefined, { cache: new DiskCache("none", tempDir()) }).items()).items, []);
});

test("coach search: per-day budget, per-query cache, failed searches not charged", async () => {
  let calls = 0;
  let fail = true;
  const fake: typeof fetch = async () => {
    calls++;
    if (fail) return new Response("down", { status: 503 });
    return Response.json({ organic_results: [{ title: "Result", link: "https://www.pokernews.com/a", snippet: "x".repeat(500) }] });
  };
  const search = new CoachSearch("key", { fetchImpl: fake, cache: new DiskCache("s", tempDir()) });
  await assert.rejects(search.search("who won the wsop"));
  fail = false;
  const results = (await search.search("who won the wsop"))!;
  assert.equal(results[0]!.source, "pokernews.com");
  assert.equal(results[0]!.snippet.length, 300);
  await search.search("WHO WON  the WSOP"); // same query, cached
  assert.equal(calls, 2);
  for (let i = 0; i < SERPAPI.coachSearchesPerDay - 1; i++) await search.search(`query ${i}`);
  assert.equal(await search.search("one too many"), null, "budget spent");
  assert.ok((await search.search("who won the wsop")) !== null, "cached answers still work");
});

test("coach uses the web_search tool, then answers with sources", async () => {
  const sent: any[] = [];
  const muse: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    sent.push(body);
    if (sent.length === 1) {
      return Response.json({
        choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "web_search", arguments: '{"query":"WSOP 2026 main event winner"}' } }] } }],
        usage: { prompt_tokens: 500, completion_tokens: 30 },
      });
    }
    return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "According to PokerNews, Jane Doe won." } }], usage: { prompt_tokens: 900, completion_tokens: 40 } });
  };
  const serp: typeof fetch = async url => {
    assert.equal(new URL(String(url)).searchParams.get("q"), "WSOP 2026 main event winner");
    return Response.json({ organic_results: [{ title: "Jane Doe wins the Main Event", link: "https://www.pokernews.com/wsop", source: "PokerNews", snippet: "Jane Doe..." }] });
  };
  const search = new CoachSearch("key", { fetchImpl: serp, cache: new DiskCache("t", tempDir()) });
  const { reply, sources, usage } = await askCoach([{ role: "user", content: "Who won the WSOP main event?" }], "muse-key", muse, search);

  assert.equal(reply, "According to PokerNews, Jane Doe won.");
  assert.deepEqual(sources.map(s => s.link), ["https://www.pokernews.com/wsop"]);
  assert.deepEqual(usage, { prompt_tokens: 1400, completion_tokens: 70, searches: 1 });
  assert.equal(sent[0].tools[0].function.name, "web_search");
  assert.match(sent[0].messages[0].content, /web_search tool/);
  // Second request: no tools, and it carries the assistant tool call plus the tool result.
  assert.equal(sent[1].tools, undefined);
  assert.equal(sent[1].messages.at(-2).tool_calls[0].id, "c1");
  assert.equal(sent[1].messages.at(-1).role, "tool");
  assert.match(sent[1].messages.at(-1).content, /Jane Doe wins the Main Event/);
});

test("without SerpApi the coach answers with no tools at all", async () => {
  let body: any;
  const muse: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init!.body));
    return Response.json({ choices: [{ message: { content: "A flush beats a straight." } }] });
  };
  const { sources } = await askCoach([{ role: "user", content: "flush vs straight?" }], "k", muse);
  assert.equal(body.tools, undefined);
  assert.doesNotMatch(body.messages[0].content, /web_search/);
  assert.deepEqual(sources, []);
});
