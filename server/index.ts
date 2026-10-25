import "dotenv/config";
import cors from "cors";
import express from "express";
import { dbReady, migrate, getWalletRecord, setDisplayName } from "./schema.js";
import { tokenRequest } from "./ably.js";
import {
  addChat,
  getChat,
  getMatch,
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
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "betonthehorns",
    elo: "solana-pending",
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

app.get("/api/queue/:mode", (req, res) => {
  if (!isMode(req.params.mode)) {
    res.status(400).json({ error: "Unknown mode" });
    return;
  }
  res.json(queueSnapshot(req.params.mode));
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
    res.status(500).json({ error: (error as Error).message });
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

app.get("/api/match/active/:walletId", (req, res) => {
  if (!isWalletId(req.params.walletId)) {
    res.status(400).json({ error: "Invalid wallet" });
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
  const walletId = readWallet(req);
  res.json({
    match: publicMatch(match, isWalletId(walletId) ? walletId : undefined),
    you: isWalletId(walletId) ? privateView(match, walletId) : null,
    chat: getChat(match.id),
  });
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
  app.listen(port, () => {
    console.log(`betonthehorns api on :${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
