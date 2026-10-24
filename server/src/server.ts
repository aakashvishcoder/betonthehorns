import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { newNonce, verifyLogin } from "./auth.ts";
import type { Chain } from "./chain.ts";
import type { Action } from "./game.ts";
import { MODES, Matchmaker, type Mode } from "./matchmaker.ts";
import { TableRunner } from "./table.ts";

/**
 * Messages from clients (JSON):
 *   { type: "login", wallet, signature }     signature = base64 ed25519 of loginMessage(nonce)
 *   { type: "queue", mode, practice? } | { type: "leave_queue" }   practice = unranked, no Elo, nothing on-chain
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

/** Listen on `port`, or attach to an existing HTTP `server` (the prototype serves its page there). */
export type GameServerOptions = { port?: number; server?: Server; chain: Chain; log?: (msg: string) => void };

export function startGameServer({ port, server, chain, log = () => {} }: GameServerOptions) {
  const wss = server ? new WebSocketServer({ server }) : new WebSocketServer({ port });
  const clients = new Set<Client>();
  const matchmaker = new Matchmaker();
  // Practice: everyone queues at the same rating, so tables fill first come, first served.
  const practice = new Matchmaker();
  const tables = new Map<string, TableRunner>();
  const tableOf = new Map<string, string>(); // wallet -> table id

  const send = (c: Client, msg: object) => c.socket.readyState === c.socket.OPEN && c.socket.send(JSON.stringify(msg));
  const byWallet = (wallet: string) => [...clients].find(c => c.wallet === wallet);
  const audience = (tableId: string) => [...clients].filter(c => (c.wallet && tableOf.get(c.wallet) === tableId) || c.watching === tableId);

  function pushTable(table: TableRunner) {
    const clock = table.clock();
    for (const c of audience(table.id)) {
      const seated = c.wallet !== undefined && tableOf.get(c.wallet) === table.id;
      send(c, { type: "table", tableId: table.id, mode: table.mode, ranked: table.ranked, view: table.game.view(seated ? c.wallet : undefined), clock, log: table.log.slice(-40) });
    }
  }

  async function seatTable(mode: Mode, players: string[], ranked: boolean) {
    const seed = randomBytes(32);
    const matchId = ranked ? await chain.createMatch(mode, players, createHash("sha256").update(seed).digest()) : null;
    const tableId = randomUUID();
    const table = new TableRunner(tableId, mode, players, seed, {
      update: () => pushTable(table),
      finished: places => void finish(table, matchId, seed, places),
    });
    table.ranked = ranked;
    tables.set(tableId, table);
    for (const p of players) {
      tableOf.set(p, tableId);
      const c = byWallet(p);
      if (c) send(c, { type: "seated", tableId, mode, ranked, matchId: matchId?.toString() ?? null });
      else table.disconnect(p);
    }
    log(`table ${tableId} (${ranked ? `${mode}, match ${matchId}` : `${mode}, practice`}) seated ${players.join(", ")}`);
    table.start();
  }

  async function finish(table: TableRunner, matchId: bigint | null, seed: Uint8Array, places: Map<string, number>) {
    const ordered = table.players.map(p => places.get(p)!);
    const standings = table.players.map((p, i) => ({ wallet: p, place: ordered[i], stack: table.game.seats[i]!.stack }));
    const standingsHash = createHash("sha256").update(JSON.stringify(standings)).digest();
    let settled = false;
    if (matchId !== null) {
      try {
        await chain.settleMatch(matchId, table.mode, table.players, ordered, seed, standingsHash);
        settled = true;
      } catch (e) {
        log(`settle failed for match ${matchId}: ${(e as Error).message}`);
      }
    }
    for (const c of audience(table.id)) {
      send(c, { type: "finished", tableId: table.id, ranked: table.ranked, places: Object.fromEntries(places), settled, seed: Buffer.from(seed).toString("hex") });
    }
    for (const p of table.players) tableOf.delete(p);
    table.close();
    tables.delete(table.id);
    log(`table ${table.id} finished; settled on-chain: ${settled}`);
  }

  const tick = setInterval(() => {
    const formed = [
      ...matchmaker.tick(Date.now()).map(t => ({ ...t, ranked: true })),
      ...practice.tick(Date.now()).map(t => ({ ...t, ranked: false })),
    ];
    for (const { mode, players, ranked } of formed) {
      seatTable(mode, players, ranked).catch(e => {
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
        if (!id) return void (c.watching = undefined); // stop watching
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
        if (matchmaker.modeOf(wallet) || practice.modeOf(wallet)) return fail("You are already queued.");
        if (msg.practice === true) {
          practice.join(mode, wallet, 1200, Date.now());
          return send(c, { type: "queued", mode, practice: true });
        }
        const rating = await chain.rating(wallet, mode);
        if (rating === null) return fail(`Register your wallet for ${mode} on-chain before queueing.`);
        matchmaker.join(mode, wallet, rating, Date.now());
        return send(c, { type: "queued", mode, rating });
      }
      case "leave_queue":
        matchmaker.leave(wallet);
        practice.leave(wallet);
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
      practice.leave(c.wallet);
      const table = tables.get(tableOf.get(c.wallet) ?? "");
      table?.disconnect(c.wallet);
    });
  });

  return {
    wss,
    tables,
    matchmaker,
    practice,
    /** True while this wallet is seated at a ranked table (the coach is off then). */
    inRankedGame: (wallet: string) => tables.get(tableOf.get(wallet) ?? "")?.ranked === true,
    close: () =>
      new Promise<void>(resolve => {
        clearInterval(tick);
        for (const t of tables.values()) t.close();
        for (const c of clients) c.socket.terminate();
        wss.close(() => resolve());
      }),
  };
}
