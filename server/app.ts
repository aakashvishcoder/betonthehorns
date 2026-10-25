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
import { listenInbox } from "./bus.js";
import {
  addChat,
  getChat,
  getMatchView,
  hydrateLiveMatches,
  joinQueue,
  leaveQueue,
  playAction,
  refreshSeatName,
  queueSnapshot,
  walletMatch,
} from "./matchmaking.js";
import { privateView, publicMatch } from "./engine.js";
import { startPractice } from "./matchmaking.js";
import { issueChallenge, login, requireWallet, sessionWallet } from "./session.js";
import { dailyPuzzles, publicPuzzle, today, type Choice } from "./puzzles.js";
import { attemptsFor, leaderboard, migratePuzzles, saveAttempt, streakFor } from "./puzzle-store.js";
import { analyze, AnalysisError, migrateAnalysis, savedAnalysis } from "./analysis.js";
import { migrateSeats } from "./seats.js";
import { query, withMigrationLock } from "./db.js";
import { markDbReady } from "./schema.js";

/** Bump when any migration changes, so instances run the setup once more. */
const SCHEMA_VERSION = "2026-10-25.1";

async function schemaIsCurrent() {
  try {
    const r = await query<{ version: string }>(`SELECT version FROM schema_version WHERE id = 1`);
    return r.rows[0]?.version === SCHEMA_VERSION;
  } catch {
    return false; // table missing (first run) or database unreachable: run the setup
  }
}

async function markSchemaCurrent() {
  await query(`CREATE TABLE IF NOT EXISTS schema_version (id INT PRIMARY KEY, version TEXT NOT NULL)`);
  await query(
    `INSERT INTO schema_version (id, version) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version`,
    [SCHEMA_VERSION],
  );
}
import { seatLabel } from "./names.js";
import { coachHandler } from "./src/coach.ts";
import { NewsFeed, newsHandler } from "./src/news.ts";
import { CoachSearch } from "./src/serpapi.ts";
import { MODES, type ActionType, type GameMode } from "./types.js";

const origin = process.env.CLIENT_ORIGIN || "http://127.0.0.1:5176";

function browserMayCall(requestOrigin: string | undefined) {
  if (!requestOrigin || requestOrigin === origin) return true;
  try {
    const url = new URL(requestOrigin);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isMode(value: unknown): value is GameMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

function isWalletId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(value)
  );
}

let booted: Promise<void> | null = null;

export function ensureReady() {
  if (!booted) {
    booted = (async () => {
      // The schema is set up once per version: instances that find it current skip straight
      // in; otherwise one instance at a time runs the setup (instances start together on Vercel).
      const setup = async () => {
        if (await schemaIsCurrent()) return;
        await migrate();
        if (dbReady) {
          await migrateSeats().catch((error) => console.warn("[db] seats", (error as Error).message));
          await migrateAnalysis().catch((error) => console.warn("[db] analysis", (error as Error).message));
          await migratePuzzles().catch((error) => console.warn("[db] puzzles", (error as Error).message));
          await markSchemaCurrent().catch((error) => console.warn("[db] schema version", (error as Error).message));
        }
      };
      if (await schemaIsCurrent()) markDbReady();
      else
        await withMigrationLock(setup).catch(async (error) => {
          console.warn("[db] migration lock", (error as Error).message);
          await setup();
        });
      await hydrateLiveMatches();
      void refundOpenEscrows().catch((error) =>
        console.warn("[elo] refund", (error as Error).message),
      );
      void listenInbox().catch((error) => {
        console.warn("[ably] inbox", (error as Error).message);
      });
    })();
  }
  return booted;
}

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

export function createApp() {
  const app = express();
  app.use(
    cors({
      origin(requestOrigin, callback) {
        callback(null, browserMayCall(requestOrigin));
      },
      credentials: true,
    }),
  );
  // AI coach (Muse) and news (SerpApi). Mounted before express.json(): these read the raw body.
  const serpKey = process.env.SERPAPI_KEY;
  const coach = coachHandler({
    apiKey: process.env.MODEL_API_KEY,
    walletOf: (req) => sessionWallet(req as express.Request),
    inRankedGame: async (wallet) => {
      const match = await walletMatch(wallet);
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
    const needed = [
      "DATABASE_URL",
      "ABLY_ROOT_KEY",
      "ABLY_SUBSCRIBE_KEY",
    ] as const;
    res.json({
      ok: true,
      service: "betonthehorns",
      elo: "settled-after-match",
      matchmaking: "global-ably",
      db: dbReady,
      env: Object.fromEntries(needed.map((key) => [key, Boolean(process.env[key])])),
    });
  });
  app.use((_req, res, next) => {
    const fail = setTimeout(() => {
      res.status(503).json({ error: "API is still starting" });
    }, 20000);
    void ensureReady()
      .then(() => {
        clearTimeout(fail);
        if (!res.headersSent) next();
      })
      .catch((error) => {
        clearTimeout(fail);
        console.error(error);
        if (!res.headersSent) res.status(500).json({ error: (error as Error).message });
      });
  });

  // Signed wallet login: sign a one-time message (free, no transaction) for a 12-hour session.
  // Every route that acts for a wallet takes it from that session, never from the request body.
  app.get("/api/auth/challenge/:walletId", (req, res) => {
    if (!isWalletId(req.params.walletId)) {
      res.status(400).json({ error: "Invalid wallet" });
      return;
    }
    res.json(issueChallenge(req.params.walletId));
  });

  app.post("/api/auth/login", (req, res) => {
    const { walletId, signature, nonce } = req.body as { walletId?: string; signature?: string; nonce?: string };
    if (!isWalletId(walletId) || typeof signature !== "string" || typeof nonce !== "string") {
      res.status(400).json({ error: "walletId, signature and nonce required" });
      return;
    }
    const session = login(walletId, signature, nonce);
    if (!session) {
      res.status(401).json({ error: "Signature check failed. Please sign in again." });
      return;
    }
    res.json({ walletId, ...session });
  });

  // Tokens are stateless; signing out just forgets the token in the browser.
  app.post("/api/auth/logout", (_req, res) => {
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
      // The token's clientId is the wallet that inbox messages act as, so it needs the session.
      const walletId = requireWallet(req, res);
      if (!walletId) return;
      res.json(await tokenRequest(walletId));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/api/queue/:mode", async (req, res) => {
    if (!isMode(req.params.mode)) {
      res.status(400).json({ error: "Unknown mode" });
      return;
    }
    res.json(await queueSnapshot(req.params.mode));
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
      const { status = 400, matchId } = error as { status?: number; matchId?: string };
      res.status(status).json({ error: (error as Error).message, ...(matchId ? { matchId } : {}) });
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

  app.get("/api/match/active/:walletId", async (req, res) => {
    // Includes the player's hole cards, so only their own session may ask.
    const walletId = requireWallet(req, res);
    if (!walletId) return;
    if (req.params.walletId !== walletId) {
      res.status(403).json({ error: "Not your wallet" });
      return;
    }
    const match = await walletMatch(walletId);
    if (!match || match.status !== "playing") {
      res.json({ match: null });
      return;
    }
    res.json({
      match: publicMatch(match, req.params.walletId),
      you: privateView(match, req.params.walletId),
      chat: await getChat(match.id),
    });
  });

  app.get("/api/match/:id", async (req, res) => {
    // Hole cards only for the signed-in player; anyone else gets the public view.
    const view = await getMatchView(req.params.id, sessionWallet(req) ?? undefined);
    if (!view) {
      res.status(404).json({ error: "Match not found" });
      return;
    }
    res.json(view);
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

  /** Practice vs AI: an unranked table right away, AI personas in the other seats. */
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
      const { status = 500, matchId } = error as { status?: number; matchId?: string };
      res.status(status).json({ error: (error as Error).message, ...(matchId ? { matchId } : {}) });
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

  // Post-game analysis (Claude Sonnet 4.5 on Snowflake Cortex), private to the player.
  // GET returns a saved one (or null); POST writes one, counted against the daily cap.
  const analysisKinds = { match: /^[0-9a-f-]{36}$/, puzzles: /^\d{4}-\d{2}-\d{2}$/ } as const;
  function analysisTarget(req: express.Request, res: express.Response) {
    const walletId = requireWallet(req, res);
    if (!walletId) return null;
    const kind = req.params.kind as keyof typeof analysisKinds;
    const ref = String(req.params.ref);
    if (!(kind in analysisKinds) || !analysisKinds[kind].test(ref)) {
      res.status(400).json({ error: "Unknown analysis" });
      return null;
    }
    return { walletId, kind, ref };
  }

  app.get("/api/analysis/:kind/:ref", async (req, res) => {
    const target = analysisTarget(req, res);
    if (!target) return;
    try {
      res.json({ analysis: await savedAnalysis(target.walletId, target.kind, target.ref) });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post("/api/analysis/:kind/:ref", async (req, res) => {
    const target = analysisTarget(req, res);
    if (!target) return;
    try {
      res.json({ analysis: await analyze(target.walletId, target.kind, target.ref) });
    } catch (error) {
      const status = error instanceof AnalysisError ? error.status : 502;
      if (status === 502) console.warn("[analysis]", (error as Error).message);
      res.status(status).json({ error: status === 502 ? "The analysis model didn't respond. Try again in a moment." : (error as Error).message });
    }
  });

  return app;
}
