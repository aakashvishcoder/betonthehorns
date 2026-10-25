import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * AI poker coach backed by Meta's Muse models (OpenAI-compatible Chat Completions).
 * The API key stays on the server (MODEL_API_KEY in server/.env); the browser only talks to /api/coach.
 */
export const COACH = {
  baseUrl: process.env.MUSE_BASE_URL ?? "https://api.meta.ai/v1",
  model: process.env.MUSE_MODEL ?? "muse-spark-1.3",
  /** Muse Spark is a reasoning model: this caps thinking + answer together. */
  maxReplyTokens: 1_500,
  /** Low thinking keeps answers quick and cheap; at the default it used up the whole budget thinking. */
  reasoningEffort: "low",
  /** Questions per browser per day; null = no limit (testing). Set e.g. 30 before launch. */
  dailyCap: null as number | null,
  /** Messages of history sent per request (user + coach turns). */
  historyMessages: 6,
  maxMessageChars: 1_000,
};

export const COACH_PROMPT = `You are the poker coach inside ALL IN, a play-money Texas Hold'em site for playing with friends.

Answer only questions about poker: rules, hand rankings, strategy, odds, etiquette, hand reviews, and how this site's games work. If asked about anything else, say in one friendly sentence that you only coach poker and offer a poker topic instead.

How this site's games work:
- Ranked Sit & Go only, in three modes with separate Elo ratings: 1v1 (2 players), 4 table and 6 table.
- No-limit Texas Hold'em. Everyone starts with 1,500 chips; blinds start at 10/20 and double every 5 minutes. Last player with chips wins.
- Heads-up: the button posts the small blind and acts first before the flop, last after it.
- 20 seconds per decision plus a 60-second time bank per game; on timeout you check if you can, otherwise fold. Disconnected players are checked/folded and keep paying blinds.
- Finishing places come from bust-out order and update Elo (start 1200, K=32, each player scored against every other by place).
- The matchmaker pairs players within ±100 Elo, widening by 50 every 15 seconds of waiting.
- The deck shuffle is committed on Solana before the deal and revealed at the end, so anyone can verify it was fair.
- Practice tables are unranked; you (the coach) are not available during ranked games.

How to coach:
- Match the player's level: plain words and short examples for beginners, concrete numbers (pot odds, equity, stack sizes in big blinds, position) for experienced players.
- For hand reviews, go street by street, name the key decision, say what you'd do and why, and mention one alternative.
- In Sit & Gos, think in big blinds; with roughly 10 big blinds or fewer, push-or-fold play matters most.
- Write card names like A♠ K♦ or "ace-king suited".
- Keep answers under about 180 words. Use short paragraphs or simple "- " lists; no markdown headings or tables.
- This site uses play money only. Never encourage real-money gambling; if someone mentions gambling problems, kindly point them to a helpline such as 1-800-GAMBLER (US).`;

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** Per-browser daily question counter (in memory; resets on restart and each UTC day). */
export class DailyCap {
  private readonly counts = new Map<string, number>();
  private day = "";
  private readonly limit: number;

  constructor(limit = 30) {
    this.limit = limit;
  }

  private roll(now: number) {
    const today = new Date(now).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.counts.clear();
    }
  }

  remaining(id: string, now = Date.now()) {
    this.roll(now);
    return this.limit - (this.counts.get(id) ?? 0);
  }

  take(id: string, now = Date.now()) {
    if (this.remaining(id, now) <= 0) return false;
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    return true;
  }

  refund(id: string) {
    this.counts.set(id, Math.max(0, (this.counts.get(id) ?? 0) - 1));
  }
}

/** Validates the client's chat history: user/assistant turns, ending with a user question. */
export function cleanHistory(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const messages = raw.slice(-COACH.historyMessages).map(m => ({
    role: m?.role,
    content: typeof m?.content === "string" ? m.content.trim().slice(0, COACH.maxMessageChars) : "",
  }));
  if (messages.some(m => (m.role !== "user" && m.role !== "assistant") || !m.content)) return null;
  if (messages.at(-1)!.role !== "user") return null;
  return messages as ChatMessage[];
}

/** If a reply hit the token cap mid-sentence, cut it back to the last complete sentence or list item. */
export function trimToSentence(text: string): string {
  const cut = Math.max(text.lastIndexOf(". "), text.lastIndexOf(".\n"), text.lastIndexOf("!"), text.lastIndexOf("?"), text.lastIndexOf("\n- "));
  if (text.endsWith(".")) return text;
  if (cut < text.length * 0.4) return `${text.trimEnd()}…`; // too little left to cut back to; mark it as cut
  return text.slice(0, cut + 1).trimEnd();
}

export async function askCoach(history: ChatMessage[], apiKey: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(`${COACH.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: COACH.model,
      messages: [{ role: "developer", content: COACH_PROMPT }, ...history],
      max_completion_tokens: COACH.maxReplyTokens,
      reasoning_effort: COACH.reasoningEffort,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Muse API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const choice = data.choices?.[0];
  const text = choice?.message?.content?.trim();
  if (!text) throw new Error(`Muse API returned no reply (finish_reason ${choice?.finish_reason ?? "?"})`);
  const reply = choice?.finish_reason === "length" ? trimToSentence(text) : text;
  return { reply, usage: data.usage };
}

export type CoachHandlerOptions = {
  apiKey?: string;
  /** Per-browser daily limit; null turns it off. */
  cap?: DailyCap | null;
  /** True if this wallet is seated at a ranked table (coach is off there). */
  inRankedGame?: (wallet: string) => boolean;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
};

/** POST /api/coach  { browserId, messages, wallet? }  ->  { reply, remaining? } */
export function coachHandler({ apiKey, cap = COACH.dailyCap === null ? null : new DailyCap(COACH.dailyCap), inRankedGame = () => false, fetchImpl, log = () => {} }: CoachHandlerOptions) {
  const json = (res: ServerResponse, status: number, body: object) =>
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") return json(res, 405, { error: "Use POST." });
    if (!apiKey) return json(res, 503, { error: "The coach isn't set up yet (missing MODEL_API_KEY on the server)." });

    let body: { browserId?: unknown; messages?: unknown; wallet?: unknown };
    try {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 20_000) return json(res, 413, { error: "Message too long." });
      }
      body = JSON.parse(raw);
    } catch {
      return json(res, 400, { error: "Bad request." });
    }

    const browserId = typeof body.browserId === "string" && /^[\w-]{8,64}$/.test(body.browserId) ? body.browserId : null;
    const history = cleanHistory(body.messages);
    if (!browserId || !history) return json(res, 400, { error: "Bad request." });
    if (typeof body.wallet === "string" && inRankedGame(body.wallet)) {
      return json(res, 403, { error: "The coach is off during ranked games. Good luck!" });
    }
    if (cap && !cap.take(browserId)) return json(res, 429, { error: "You've used today's coach questions. Come back tomorrow!", remaining: 0 });

    try {
      const { reply, usage } = await askCoach(history, apiKey, fetchImpl);
      log(`coach: ${usage?.prompt_tokens ?? "?"} in / ${usage?.completion_tokens ?? "?"} out tokens`);
      return json(res, 200, { reply, ...(cap ? { remaining: cap.remaining(browserId) } : {}) });
    } catch (e) {
      cap?.refund(browserId); // failures don't use up a question
      log(`coach error: ${(e as Error).message}`);
      return json(res, 502, { error: "The coach couldn't answer just now. Please try again." });
    }
  };
}
