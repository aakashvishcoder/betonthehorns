import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { AiPlayer } from "./ai/ai-player.ts";
import type { SnowflakeAuth } from "./ai/cortex.ts";
import { aiSeats, isAi, personaOf } from "./ai/personas.ts";
import { MemoryStyleStore, type StyleStore } from "./ai/style-store.ts";
import { StatsTracker, blendStyle, skillFromElo } from "./ai/style.ts";
import { newNonce, verifyLogin } from "./auth.ts";
import type { Chain } from "./chain.ts";
import { DailyCap } from "./coach.ts";
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
 *   { type: "practice_ai", mode }            practice vs AI opponents (Snowflake Cortex) filling the other seats
 *   { type: "watch", tableId }               spectate (no login needed)
 * Messages to clients:
 *   challenge, welcome, queued, left_queue, seated, table, chat, finished, error
 */
type Client = { socket: WebSocket; nonce: string; wallet?: string; watching?: string; lastChatAt: number };

const CHAT_MAX = 200;
const CHAT_GAP_MS = 1_000;
const TICK_MS = 1_000;

export type AiOptions = {
  /** Snowflake Cortex credentials; without them AIs play on the rule engine only. */
  auth: SnowflakeAuth | null;
  /** AI practice games per player per day. */
  gamesPerDay?: number;
  /** Human-like pause before an AI acts, in ms: [min, max]. */
  thinkMs?: [number, number];
  cortexTimeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/** Listen on `port`, or attach to an existing HTTP `server` (the prototype serves its page there). */
export type GameServerOptions = {
  port?: number;
  server?: Server;
  chain: Chain;
  /** Per-game style counters (Snowflake in production). */
  styleStore?: StyleStore;
  ai?: AiOptions;
  log?: (msg: string) => void;
};

export function startGameServer({ port, server, chain, styleStore = new MemoryStyleStore(), ai = { auth: null }, log = () => {} }: GameServerOptions) {
  const wss = server ? new WebSocketServer({ server }) : new WebSocketServer({ port });
  const clients = new Set<Client>();
  const matchmaker = new Matchmaker();
  // Practice: everyone queues at the same rating, so tables fill first come, first served.
  const practice = new Matchmaker();
  const tables = new Map<string, TableRunner>();
  const tableOf = new Map<string, string>(); // wallet -> table id
  const aiPlayers = new Map<string, Map<string, AiPlayer>>(); // table id -> AI seats
  const aiTurn = new Map<string, string>(); // table id -> turn already being decided
  const aiUsage = new Map<string, { calls: number; fallbacks: number; in: number; out: number }>();
  const aiGamesToday = new DailyCap(ai.gamesPerDay ?? 5);

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

  async function seatTable(mode: Mode, players: string[], ranked: boolean, ais?: Map<string, AiPlayer>) {
    const seed = randomBytes(32);
    const matchId = ranked ? await chain.createMatch(mode, players, createHash("sha256").update(seed).digest()) : null;
    const tableId = randomUUID();
    const stats = new StatsTracker();
    const table = new TableRunner(tableId, mode, players, seed, {
      update: () => {
        pushTable(table);
        driveAi(table);
      },
      finished: places => void finish(table, matchId, seed, places, stats),
      handStarted: ids => stats.handStarted(ids),
      action: (player, action, street) => stats.action(player, action, street),
      handEnded: () => {
        const showdown = table.game.lastResult.some(p => p.hand !== undefined);
        const winners = new Set(table.game.lastResult.flatMap(p => p.winners));
        stats.handEnded(
          table.game.board.length >= 3,
          showdown ? table.game.seats.filter(s => s.shown && !s.folded && s.cards.length).map(s => ({ player: s.id, won: winners.has(s.id) })) : [],
        );
      },
    });
    if (ais) {
      aiPlayers.set(tableId, ais);
      aiUsage.set(tableId, { calls: 0, fallbacks: 0, in: 0, out: 0 });
    }
    table.ranked = ranked;
    tables.set(tableId, table);
    for (const p of players) {
      tableOf.set(p, tableId);
      const c = byWallet(p);
      if (c) send(c, { type: "seated", tableId, mode, ranked, vsAi: !!ais, matchId: matchId?.toString() ?? null });
      else if (!isAi(p)) table.disconnect(p);
    }
    log(`table ${tableId} (${ranked ? `${mode}, match ${matchId}` : `${mode}, practice`}) seated ${players.join(", ")}`);
    table.start();
  }

  /** Lets the AI whose turn it is act, after a human-like pause. */
  function driveAi(table: TableRunner) {
    const ais = aiPlayers.get(table.id);
    if (!ais) return;
    const humans = table.players.filter(p => !isAi(p));
    const humansIn = humans.filter(p => !table.game.seats[table.game.seatOf(p)]!.out);
    // Practice vs AI is over for the human once they bust: don't let AIs play on alone.
    if (humansIn.length === 0 && table.game.street === "done") return void table.finishNow();
    const toAct = table.game.view().toAct;
    if (!toAct || !ais.has(toAct)) return;
    const key = `${table.game.handNo}:${table.log.length}`;
    if (aiTurn.get(table.id) === key) return;
    aiTurn.set(table.id, key);

    // Cortex only while a human is connected and still in the game; a disconnected human is blinded out vs rule-based AIs.
    const humanConnected = humansIn.some(p => table.connected.has(p));
    const legal = table.game.legal(toAct);
    const bigSpot = legal.toCall > 0.2 * table.game.seats[table.game.seatOf(toAct)]!.stack;
    const [min, max] = ai.thinkMs ?? [1_000, 2_500];
    const pause = min + Math.random() * (max - min) + (bigSpot && humanConnected ? 1_500 : 0);

    const decision = ais.get(toAct)!.decide(table.game, {
      useCortex: humanConnected,
      fetchImpl: ai.fetchImpl,
      timeoutMs: ai.cortexTimeoutMs,
    });
    void Promise.all([decision, new Promise(r => setTimeout(r, pause))]).then(([d]) => {
      if (!tables.has(table.id) || aiTurn.get(table.id) !== key || table.game.view().toAct !== toAct) return;
      const usage = aiUsage.get(table.id)!;
      if (d.source === "cortex") {
        usage.calls++;
        usage.in += d.tokens?.in ?? 0;
        usage.out += d.tokens?.out ?? 0;
      } else if (d.error) {
        usage.fallbacks++;
        log(`AI ${toAct} fell back to rules: ${d.error}`);
      }
      try {
        table.act(toAct, d.action);
      } catch (e) {
        log(`AI ${toAct} move rejected (${(e as Error).message}); folding/checking`);
        table.act(toAct, table.game.legal(toAct).canCheck ? { type: "check" } : { type: "fold" });
      }
    });
  }

  async function startAiPractice(wallet: string, mode: Mode) {
    const elo = (await chain.rating(wallet, mode).catch(() => null)) ?? 1200;
    const observed = await styleStore.styleOf(wallet).catch(e => {
      log(`style lookup failed: ${(e as Error).message}`);
      return null;
    });
    const mirrored = blendStyle(observed, elo);
    const skill = skillFromElo(elo);
    const ids = aiSeats(MODES[mode] - 1);
    const ais = new Map(ids.map(id => [id, new AiPlayer(id, personaOf(id)!, mirrored, skill, ai.auth)]));
    log(`AI practice for ${wallet} (${mode}, Elo ${elo}, ${observed ? `${observed.hands} hands of history` : "no history"}): ${ids.join(", ")}`);
    await seatTable(mode, [wallet, ...ids], false, ais);
  }

  async function finish(table: TableRunner, matchId: bigint | null, seed: Uint8Array, places: Map<string, number>, stats: StatsTracker) {
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
    const humans = table.players.filter(p => !isAi(p));
    const rows = humans.flatMap(p => {
      const s = stats.stats.get(p);
      return s ? [{ ...s, wallet: p, mode: table.mode, ranked: table.ranked, place: places.get(p)!, players: table.players.length }] : [];
    });
    styleStore.record(rows).catch(e => log(`style store write failed: ${(e as Error).message}`));
    const usage = aiUsage.get(table.id);
    if (usage) log(`AI usage: ${usage.calls} Cortex calls (${usage.in} in / ${usage.out} out tokens), ${usage.fallbacks} rule fallbacks`);

    for (const p of table.players) tableOf.delete(p);
    table.close();
    tables.delete(table.id);
    aiPlayers.delete(table.id);
    aiTurn.delete(table.id);
    aiUsage.delete(table.id);
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
      case "practice_ai": {
        const mode = msg.mode as Mode;
        if (!(mode in MODES)) return fail("Unknown mode.");
        if (tableOf.has(wallet)) return fail("You are already at a table.");
        if (matchmaker.modeOf(wallet) || practice.modeOf(wallet)) return fail("Leave the queue first.");
        if (!aiGamesToday.take(wallet)) return fail("You've played today's AI practice games. Come back tomorrow!");
        try {
          await startAiPractice(wallet, mode);
        } catch (e) {
          aiGamesToday.refund(wallet);
          log(`could not start AI practice: ${(e as Error).message}`);
          fail("Could not start the practice game; please try again.");
        }
        return;
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
