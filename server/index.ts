import "dotenv/config";
import cors from "cors";
import express from "express";
import {
  dbReady,
  migrate,
  getWalletRecord,
  setDisplayName,
  getLeaderboard,
  getProfile,
  refundOpenEscrows,
  setShowcase,
} from "./schema.js";
import { buildBadges } from "./badges.js";
import { rankFromElo, STARTING_ELO } from "./elo.js";
import { tokenRequest } from "./ably.js";
import {
  addChat,
  getChat,
  getMatch,
  joinQueue,
  leaveQueue,
  playAction,
  startPractice,
  refreshSeatName,
  queueSnapshot,
  walletMatch,
} from "./matchmaking.js";
import { privateView, publicMatch } from "./engine.js";
import { issueChallenge, login, logout, requireWallet, sessionWallet } from "./session.js";
import { dailyPuzzles, publicPuzzle, today, type Choice } from "./puzzles.js";
import { attemptsFor, leaderboard, migratePuzzles, saveAttempt, streakFor } from "./puzzle-store.js";
import { seatLabel } from "./names.js";
import { coachHandler } from "./src/coach.ts";
import { NewsFeed, newsHandler } from "./src/news.ts";
import { CoachSearch } from "./src/serpapi.ts";
import { MODES, type ActionType, type GameMode } from "./types.js";

const port = Number(process.env.PORT || 4000);
const origin = process.env.CLIENT_ORIGIN || "http://127.0.0.1:5176";

function isMode(value: unknown): value is GameMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

function isWalletId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(value)
  );
}

const app = express();
app.use(
  cors({
    origin(requestOrigin, callback) {
      if (
        !requestOrigin ||
        requestOrigin === origin ||
        /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(requestOrigin)
      ) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  }),
);
// AI coach (Muse) and news (SerpApi). Mounted before express.json(): these read the raw body.
const serpKey = process.env.SERPAPI_KEY;
const coach = coachHandler({
  apiKey: process.env.MODEL_API_KEY,
  walletOf: (req) => sessionWallet(req as express.Request),
  inRankedGame: (wallet) => {
    const match = walletMatch(wallet);
    return match?.status === "playing" && match.ranked;
  },
  search: serpKey ? new CoachSearch(serpKey) : undefined,
  log: (msg) => console.log(`[coach] ${msg}`),
});
const news = newsHandler(new NewsFeed(serpKey, { log: (msg) => console.log(`[news] ${msg}`) }));
app.post("/api/coach", (req, res) => void coach(req, res));
app.get("/api/news", (req, res) => void news(req, res));

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "betonthehorns",
    elo: "settled-after-match",
    db: dbReady,
  });
});

// Signed wallet login: sign a one-time message (free, no transaction) for a 12-hour session.
app.get("/api/auth/challenge/:walletId", (req, res) => {
  if (!isWalletId(req.params.walletId)) {
    res.status(400).json({ error: "Invalid wallet" });
    return;
  }
  res.json(issueChallenge(req.params.walletId));
});

app.post("/api/auth/login", (req, res) => {
  const { walletId, signature } = req.body as { walletId?: string; signature?: string };
  if (!isWalletId(walletId) || typeof signature !== "string") {
    res.status(400).json({ error: "walletId and signature required" });
    return;
  }
  const session = login(walletId, signature);
  if (!session) {
    res.status(401).json({ error: "Signature check failed. Please sign in again." });
    return;
  }
  res.json({ walletId, ...session });
});

app.post("/api/auth/logout", (req, res) => {
  const header = req.header("authorization") ?? "";
  if (header.startsWith("Bearer ")) logout(header.slice(7));
  res.json({ ok: true });
});

app.get("/api/wallet/:walletId", async (req, res) => {
  try {
    if (!isWalletId(req.params.walletId)) {
      res.status(400).json({ error: "Invalid wallet" });
      return;
    }
    if (!dbReady) {
      res.json({
        walletId: req.params.walletId,
        displayName: null,
        eloHistory: { "hands-up": [], "sng-4": [], "sng-6": [] },
        db: false,
      });
      return;
    }
    res.json(await getWalletRecord(req.params.walletId));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/profile/name", async (req, res) => {
  try {
    const walletId = requireWallet(req, res);
    if (!walletId) return;
    const displayName = (req.body as { displayName?: string }).displayName;
    if (typeof displayName !== "string") {
      res.status(400).json({ error: "displayName required" });
      return;
    }
    if (!dbReady) {
      res.status(503).json({ error: "Database is not connected" });
      return;
    }
    const saved = await setDisplayName(walletId, displayName);
    await refreshSeatName(walletId);
    res.json({ walletId, displayName: saved });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

function profilePayload(
  address: string,
  record: Awaited<ReturnType<typeof getProfile>>,
) {
  const byMode = new Map(record.stats.map((row) => [row.mode, row]));
  const modes = MODES.map((mode) => {
    const row = byMode.get(mode);
    const elo = row?.elo ?? STARTING_ELO;
    return {
      mode,
      elo,
      rank: rankFromElo(elo),
      games: row?.games ?? 0,
      wins: row?.wins ?? 0,
      hands: row?.hands ?? 0,
    };
  });
  const hands = modes.reduce((sum, mode) => sum + mode.hands, 0);
  const wins = modes.reduce((sum, mode) => sum + mode.wins, 0);
  return {
    address,
    displayName: record.displayName,
    modes,
    hands,
    wins,
    games: modes.reduce((sum, mode) => sum + mode.games, 0),
    recent: record.recent,
    badges: buildBadges({ modes, hands, wins, showcase: record.showcase }),
  };
}

app.get("/api/leaderboard/:mode", async (req, res) => {
  try {
    if (!isMode(req.params.mode)) {
      res.status(400).json({ error: "Unknown mode" });
      return;
    }
    if (!dbReady) {
      res.json({ mode: req.params.mode, rows: [], db: false });
      return;
    }
    res.json({ mode: req.params.mode, rows: await getLeaderboard(req.params.mode) });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/profile/:walletId", async (req, res) => {
  try {
    if (!isWalletId(req.params.walletId)) {
      res.status(400).json({ error: "Invalid wallet" });
      return;
    }
    if (!dbReady) {
      res.status(503).json({ error: "Database is not connected" });
      return;
    }
    res.json(profilePayload(req.params.walletId, await getProfile(req.params.walletId)));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/profile/showcase", async (req, res) => {
  try {
    const walletId = requireWallet(req, res);
    if (!walletId) return;
    const shown = (req.body as { shown?: unknown }).shown;
    if (!Array.isArray(shown) || shown.some((key) => typeof key !== "string")) {
      res.status(400).json({ error: "shown keys required" });
      return;
    }
    if (!dbReady) {
      res.status(503).json({ error: "Database is not connected" });
      return;
    }
    const record = await getProfile(walletId);
    const payload = profilePayload(walletId, record);
    const allowed = new Set(payload.badges.filter((badge) => badge.earned).map((badge) => badge.key));
    const next = new Set(shown.filter((key) => allowed.has(key)));
    await setShowcase(
      walletId,
      [...allowed].map((key) => ({ key, shown: next.has(key) })),
    );
    const saved = await getProfile(walletId);
    res.json(profilePayload(walletId, saved));
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/ably/token", async (req, res) => {
  try {
    const walletId = requireWallet(req, res);
    if (!walletId) return;
    res.json(await tokenRequest(walletId));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/queue/:mode", (req, res) => {
  if (!isMode(req.params.mode)) {
    res.status(400).json({ error: "Unknown mode" });
    return;
  }
  res.json(queueSnapshot(req.params.mode));
});

app.post("/api/queue", async (req, res) => {
  try {
    const walletId = requireWallet(req, res);
    if (!walletId) return;
    const { mode } = req.body as { mode?: string };
    if (!isMode(mode)) {
      res.status(400).json({ error: "mode required" });
      return;
    }
    res.json(await joinQueue(walletId, mode));
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.delete("/api/queue", async (req, res) => {
  try {
    const walletId = requireWallet(req, res);
    if (!walletId) return;
    await leaveQueue(walletId);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Practice vs AI (unranked): the AI personas fill the other seats.
app.post("/api/practice", async (req, res) => {
  try {
    const walletId = requireWallet(req, res);
    if (!walletId) return;
    const { mode } = req.body as { mode?: string };
    if (!isMode(mode)) {
      res.status(400).json({ error: "mode required" });
      return;
    }
    res.json(await startPractice(walletId, mode));
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

app.get("/api/match/active/:walletId", (req, res) => {
  // Includes the player's hole cards, so only their own session may ask.
  const walletId = requireWallet(req, res);
  if (!walletId) return;
  if (req.params.walletId !== walletId) {
    res.status(403).json({ error: "That isn't your wallet." });
    return;
  }
  const match = walletMatch(req.params.walletId);
  if (!match) {
    res.json({ match: null });
    return;
  }
  res.json({
    match: publicMatch(match, req.params.walletId),
    you: privateView(match, req.params.walletId),
    chat: getChat(match.id),
  });
});

app.get("/api/match/:id", (req, res) => {
  const match = getMatch(req.params.id);
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  // Hole cards only for the signed-in player; anyone else gets the public view.
  const walletId = sessionWallet(req) ?? undefined;
  res.json({
    match: publicMatch(match, walletId),
    you: walletId ? privateView(match, walletId) : null,
    chat: getChat(match.id),
  });
});

app.post("/api/match/:id/action", async (req, res) => {
  try {
    const walletId = requireWallet(req, res);
    if (!walletId) return;
    const { type, raiseTo } = req.body as { type?: ActionType; raiseTo?: number };
    if (!type) {
      res.status(400).json({ error: "type required" });
      return;
    }
    res.json(await playAction(req.params.id, walletId, { type, raiseTo }));
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/match/:id/chat", async (req, res) => {
  try {
    const walletId = requireWallet(req, res);
    if (!walletId) return;
    const text = (req.body as { text?: string }).text;
    if (typeof text !== "string") {
      res.status(400).json({ error: "text required" });
      return;
    }
    res.json({ messages: await addChat(req.params.id, walletId, text) });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// Daily puzzles: same five for everyone each UTC day. Answers never leave the server until you
// commit to a choice; signed-in players get one try per puzzle, a streak and the leaderboard.
app.get("/api/puzzles/today", async (req, res) => {
  try {
    const day = today();
    const puzzles = dailyPuzzles(day);
    const walletId = sessionWallet(req);
    const attempts = walletId ? await attemptsFor(walletId, day) : [];
    res.json({
      day,
      puzzles: puzzles.map(publicPuzzle),
      attempts: attempts.map((a) => ({ ...a, solution: puzzles[a.index - 1]!.solution })),
      streak: walletId ? await streakFor(walletId, day) : 0,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/puzzles/answer", async (req, res) => {
  try {
    const { day, index, choice } = req.body as { day?: string; index?: number; choice?: string };
    if (day !== today()) {
      res.status(410).json({ error: "That puzzle set has ended. Reload for today's puzzles." });
      return;
    }
    const puzzle = dailyPuzzles(day)[Number(index) - 1];
    if (!puzzle || !puzzle.options.some((o) => o.id === choice)) {
      res.status(400).json({ error: "Unknown puzzle or choice" });
      return;
    }
    const correct = choice === puzzle.solution.answer;
    const walletId = sessionWallet(req);
    if (walletId) {
      const saved = await saveAttempt(walletId, day, { index: puzzle.index, choice: choice as Choice, correct });
      if (!saved) {
        const previous = (await attemptsFor(walletId, day)).find((a) => a.index === puzzle.index)!;
        res.status(409).json({ error: "You've already answered this one.", ...previous, solution: puzzle.solution });
        return;
      }
    }
    res.json({
      index: puzzle.index,
      choice,
      correct,
      solution: puzzle.solution,
      saved: Boolean(walletId),
      streak: walletId ? await streakFor(walletId, day) : 0,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/puzzles/leaderboard", async (_req, res) => {
  try {
    const day = today();
    const rows = await leaderboard(day);
    res.json({ day, rows: rows.map((r) => ({ ...r, name: seatLabel(r.walletId) })) });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

async function start() {
  await migrate();
  await refundOpenEscrows();
  if (dbReady) await migratePuzzles().catch((error) => console.warn("[db] puzzles", (error as Error).message));
  // Build today's puzzles up front (and again after midnight) so no visitor waits for them.
  setTimeout(() => dailyPuzzles(today()), 0);
  setInterval(() => dailyPuzzles(today()), 10 * 60_000).unref();
  app.listen(port, () => {
    console.log(`betonthehorns api on :${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
