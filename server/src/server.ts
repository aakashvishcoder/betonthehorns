import { createHash, randomBytes, randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { newNonce, verifyLogin } from "./auth.ts";
import type { Chain } from "./chain.ts";
import type { Action } from "./game.ts";
import { MODES, Matchmaker, type Mode } from "./matchmaker.ts";
import { TableRunner } from "./table.ts";

/**
 * Messages from clients (JSON):
 *   { type: "login", wallet, signature }     signature = base64 ed25519 of loginMessage(nonce)
 *   { type: "queue", mode } | { type: "leave_queue" }
 *   { type: "action", action }               action = fold | check | call | { type: "raise", to }
 *   { type: "show" }                         reveal cards after an uncontested win
 *   { type: "chat", text }
 *   { type: "watch", tableId }               spectate (no login needed)
 * Messages to clients:
 *   challenge, welcome, queued, left_queue, seated, table, chat, finished, error
 */
type Client = { socket: WebSocket; nonce: string; wallet?: string; watching?: string; lastChatAt: number };

const CHAT_MAX = 200;
const CHAT_GAP_MS = 1_000;
const TICK_MS = 1_000;

export type GameServerOptions = { port: number; chain: Chain; log?: (msg: string) => void };

export function startGameServer({ port, chain, log = () => {} }: GameServerOptions) {
  const wss = new WebSocketServer({ port });
  const clients = new Set<Client>();
  const matchmaker = new Matchmaker();
  const tables = new Map<string, TableRunner>();
  const tableOf = new Map<string, string>(); // wallet -> table id

  const send = (c: Client, msg: object) => c.socket.readyState === c.socket.OPEN && c.socket.send(JSON.stringify(msg));
  const byWallet = (wallet: string) => [...clients].find(c => c.wallet === wallet);
  const audience = (tableId: string) => [...clients].filter(c => (c.wallet && tableOf.get(c.wallet) === tableId) || c.watching === tableId);

  function pushTable(table: TableRunner) {
    const clock = table.clock();
    for (const c of audience(table.id)) {
      const seated = c.wallet !== undefined && tableOf.get(c.wallet) === table.id;
      send(c, { type: "table", tableId: table.id, mode: table.mode, view: table.game.view(seated ? c.wallet : undefined), clock });
    }
  }

  async function seatTable(mode: Mode, players: string[]) {
    const seed = randomBytes(32);
    const matchId = await chain.createMatch(mode, players, createHash("sha256").update(seed).digest());
    const tableId = randomUUID();
    const table = new TableRunner(tableId, mode, players, seed, {
      update: () => pushTable(table),
      finished: places => void finish(table, matchId, seed, places),
    });
    tables.set(tableId, table);
    for (const p of players) {
      tableOf.set(p, tableId);
      const c = byWallet(p);
      if (c) send(c, { type: "seated", tableId, mode, matchId: matchId.toString() });
      else table.disconnect(p);
    }
    log(`table ${tableId} (${mode}, match ${matchId}) seated ${players.join(", ")}`);
    table.start();
  }

  async function finish(table: TableRunner, matchId: bigint, seed: Uint8Array, places: Map<string, number>) {
    const ordered = table.players.map(p => places.get(p)!);
    const standings = table.players.map((p, i) => ({ wallet: p, place: ordered[i], stack: table.game.seats[i]!.stack }));
    const standingsHash = createHash("sha256").update(JSON.stringify(standings)).digest();
    let settled = true;
    try {
      await chain.settleMatch(matchId, table.mode, table.players, ordered, seed, standingsHash);
    } catch (e) {
      settled = false;
      log(`settle failed for match ${matchId}: ${(e as Error).message}`);
    }
    for (const c of audience(table.id)) {
      send(c, { type: "finished", tableId: table.id, places: Object.fromEntries(places), settled, seed: Buffer.from(seed).toString("hex") });
    }
    for (const p of table.players) tableOf.delete(p);
    table.close();
    tables.delete(table.id);
    log(`table ${table.id} finished; settled on-chain: ${settled}`);
  }

  const tick = setInterval(() => {
    for (const { mode, players } of matchmaker.tick(Date.now())) {
      seatTable(mode, players).catch(e => {
        log(`could not open match: ${(e as Error).message}`);
        for (const p of players) {
          const c = byWallet(p);
          if (c) send(c, { type: "error", message: "Could not start the match; please queue again." });
        }
      });
    }
  }, TICK_MS);

  async function handle(c: Client, msg: Record<string, unknown>) {
    const fail = (message: string) => send(c, { type: "error", message });
    const table = c.wallet ? tables.get(tableOf.get(c.wallet) ?? "") : undefined;

    switch (msg.type) {
      case "login": {
        const wallet = String(msg.wallet ?? "");
        if (!verifyLogin(wallet, c.nonce, String(msg.signature ?? ""))) return fail("Signature check failed.");
        c.nonce = newNonce(); // one use only
        byWallet(wallet)?.socket.close(4000, "Logged in elsewhere");
        c.wallet = wallet;
        send(c, { type: "welcome", wallet });
        const seatedAt = tableOf.get(wallet);
        if (seatedAt) {
          tables.get(seatedAt)!.reconnect(wallet);
          send(c, { type: "seated", tableId: seatedAt });
          pushTable(tables.get(seatedAt)!);
        }
        return;
      }
      case "watch": {
        const id = String(msg.tableId ?? "");
        if (!tables.has(id)) return fail("No such table.");
        c.watching = id;
        return pushTable(tables.get(id)!);
      }
    }

    if (!c.wallet) return fail("Log in with your wallet first.");
    const wallet = c.wallet;
    switch (msg.type) {
      case "queue": {
        const mode = msg.mode as Mode;
        if (!(mode in MODES)) return fail("Unknown mode.");
        if (tableOf.has(wallet)) return fail("You are already at a table.");
        if (matchmaker.modeOf(wallet)) return fail("You are already queued.");
        const rating = await chain.rating(wallet, mode);
        if (rating === null) return fail(`Register your wallet for ${mode} on-chain before queueing.`);
        matchmaker.join(mode, wallet, rating, Date.now());
        return send(c, { type: "queued", mode, rating });
      }
      case "leave_queue":
        matchmaker.leave(wallet);
        return send(c, { type: "left_queue" });
      case "action":
        if (!table) return fail("You are not at a table.");
        try {
          table.act(wallet, msg.action as Action);
        } catch (e) {
          fail((e as Error).message);
        }
        return;
      case "show":
        if (!table) return fail("You are not at a table.");
        try {
          table.show(wallet);
        } catch (e) {
          fail((e as Error).message);
        }
        return;
      case "chat": {
        if (!table) return fail("You are not at a table.");
        const text = String(msg.text ?? "").trim().slice(0, CHAT_MAX);
        if (!text) return;
        if (Date.now() - c.lastChatAt < CHAT_GAP_MS) return fail("Slow down a little.");
        c.lastChatAt = Date.now();
        for (const to of audience(table.id)) send(to, { type: "chat", tableId: table.id, from: wallet, text });
        return;
      }
      default:
        return fail("Unknown message.");
    }
  }

  wss.on("connection", socket => {
    const c: Client = { socket, nonce: newNonce(), lastChatAt: 0 };
    clients.add(c);
    send(c, { type: "challenge", nonce: c.nonce });
    socket.on("message", data => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return send(c, { type: "error", message: "Bad JSON." });
      }
      handle(c, msg).catch(e => send(c, { type: "error", message: (e as Error).message }));
    });
    socket.on("close", () => {
      clients.delete(c);
      if (!c.wallet || byWallet(c.wallet)) return; // still connected elsewhere
      matchmaker.leave(c.wallet);
      const table = tables.get(tableOf.get(c.wallet) ?? "");
      table?.disconnect(c.wallet);
    });
  });

  return {
    wss,
    tables,
    matchmaker,
    close: () =>
      new Promise<void>(resolve => {
        clearInterval(tick);
        for (const t of tables.values()) t.close();
        for (const c of clients) c.socket.terminate();
        wss.close(() => resolve());
      }),
  };
}
