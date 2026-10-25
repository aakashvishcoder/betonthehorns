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
  rebuildRatingsFromHistory,
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
import { MODES, type ActionType, type GameMode } from "./types.js";

const port = Number(process.env.PORT || 4000);
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

function readWallet(req: express.Request) {
  const fromBody = (req.body as { walletId?: string } | undefined)?.walletId;
  const fromQuery = typeof req.query.walletId === "string" ? req.query.walletId : undefined;
  const fromHeader = req.header("x-wallet-id");
  return fromBody || fromQuery || fromHeader;
}

const app = express();
app.use(
  cors({
    origin(requestOrigin, callback) {
      callback(null, browserMayCall(requestOrigin));
    },
    credentials: true,
  }),
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "betonthehorns",
    elo: "settled-after-match",
    matchmaking: "global-ably",
    db: dbReady,
  });
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
    const walletId = readWallet(req);
    const displayName = (req.body as { displayName?: string }).displayName;
    if (!isWalletId(walletId) || typeof displayName !== "string") {
      res.status(400).json({ error: "walletId and displayName required" });
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
    const walletId = readWallet(req);
    const shown = (req.body as { shown?: unknown }).shown;
    if (!isWalletId(walletId) || !Array.isArray(shown) || shown.some((key) => typeof key !== "string")) {
      res.status(400).json({ error: "walletId and shown keys required" });
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
    const walletId = readWallet(req);
    if (!isWalletId(walletId)) {
      res.status(400).json({ error: "walletId required" });
      return;
    }
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
    const { mode } = req.body as { mode?: string };
    const walletId = readWallet(req);
    if (!isWalletId(walletId) || !isMode(mode)) {
      res.status(400).json({ error: "walletId and mode required" });
      return;
    }
    res.json(await joinQueue(walletId, mode));
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.delete("/api/queue", async (req, res) => {
  try {
    const walletId = readWallet(req);
    if (!isWalletId(walletId)) {
      res.status(400).json({ error: "walletId required" });
      return;
    }
    await leaveQueue(walletId);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/match/active/:walletId", async (req, res) => {
  if (!isWalletId(req.params.walletId)) {
    res.status(400).json({ error: "Invalid wallet" });
    return;
  }
  const match = await walletMatch(req.params.walletId);
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
  const walletId = readWallet(req);
  const view = await getMatchView(req.params.id, isWalletId(walletId) ? walletId : undefined);
  if (!view) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  res.json(view);
});

app.post("/api/match/:id/action", async (req, res) => {
  try {
    const walletId = readWallet(req);
    const { type, raiseTo } = req.body as { type?: ActionType; raiseTo?: number };
    if (!isWalletId(walletId) || !type) {
      res.status(400).json({ error: "walletId and type required" });
      return;
    }
    res.json(await playAction(req.params.id, walletId, { type, raiseTo }));
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/match/:id/chat", async (req, res) => {
  try {
    const walletId = readWallet(req);
    const text = (req.body as { text?: string }).text;
    if (!isWalletId(walletId) || typeof text !== "string") {
      res.status(400).json({ error: "walletId and text required" });
      return;
    }
    res.json({ messages: await addChat(req.params.id, walletId, text) });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

async function start() {
  await migrate();
  await hydrateLiveMatches();
  await refundOpenEscrows();
  await rebuildRatingsFromHistory();
  await listenInbox().catch((error) => {
    console.warn("[ably] inbox", (error as Error).message);
  });
  app.listen(port, "0.0.0.0", () => {
    console.log(`betonthehorns api on :${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
