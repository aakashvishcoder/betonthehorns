import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { MemoryChain } from "../chain.ts";
import { startGameServer } from "../server.ts";
import { TIMING } from "../table.ts";
import { fakeWallet } from "../wallet.ts";
import { MemoryStyleStore } from "./style-store.ts";

// Fake Cortex: records which model was asked, and always calls/checks. No real calls.
const calls: string[] = [];
const fakeCortex: typeof fetch = async (_url, init) => {
  const body = JSON.parse(String(init!.body));
  calls.push(body.model);
  const canCheck = /Legal: check/.test(body.messages[1].content);
  return Response.json({ choices: [{ message: { content: JSON.stringify({ action: canCheck ? "check" : "call", amount: 0 }) } }] });
};

const PORT = 18_990;
const chain = new MemoryChain({ autoRegister: true });
const store = new MemoryStyleStore();
let server: ReturnType<typeof startGameServer>;

before(() => {
  Object.assign(TIMING, { betweenHandsMs: 5, showWindowMs: 5, turnMs: 5_000, timeBankMs: 1_000 });
  server = startGameServer({
    port: PORT,
    chain,
    styleStore: store,
    ai: { auth: { account: "test-acct", token: "t" }, gamesPerDay: 3, thinkMs: [0, 0], fetchImpl: fakeCortex },
  });
});
after(() => server.close());

type Msg = { type: string; [k: string]: any };

/** A human player that shoves every turn (so games end fast). */
async function player() {
  const w = fakeWallet();
  const socket = new WebSocket(`ws://localhost:${PORT}`);
  const inbox: Msg[] = [];
  const waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  let shove = true;
  socket.on("message", data => {
    const m = JSON.parse(String(data)) as Msg;
    inbox.push(m);
    if (m.type === "challenge") socket.send(JSON.stringify({ type: "login", wallet: w.address, signature: w.signLogin(m.nonce) }));
    if (shove && m.type === "table" && m.view.toAct === w.address && m.view.legal) {
      const l = m.view.legal;
      socket.send(JSON.stringify({ type: "action", action: l.canRaise ? { type: "raise", to: l.maxRaiseTo } : l.canCheck ? { type: "check" } : { type: "call" } }));
    }
    for (const x of [...waiters]) if (x.pred(m)) (waiters.splice(waiters.indexOf(x), 1), x.resolve(m));
  });
  const next = (pred: (m: Msg) => boolean, timeoutMs = 20_000) =>
    new Promise<Msg>((resolve, reject) => {
      const found = inbox.find(pred);
      if (found) return resolve(found);
      waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error("timed out")), timeoutMs);
    });
  await next(m => m.type === "welcome");
  return { wallet: w.address, socket, inbox, next, send: (m: object) => socket.send(JSON.stringify(m)), stopShoving: () => (shove = false) };
}

test("1v1 vs The Shark: Cortex decides, game finishes, only the human's style is stored", async () => {
  const p = await player();
  p.send({ type: "practice_ai", mode: "heads_up" });
  const seated = await p.next(m => m.type === "seated");
  assert.equal(seated.ranked, false);
  assert.equal(seated.vsAi, true);
  const table = await p.next(m => m.type === "table");
  assert.deepEqual(table.view.seats.map((s: any) => s.id).slice(1), ["ai:shark:1"]);
  const done = await p.next(m => m.type === "finished");
  assert.deepEqual(Object.values(done.places).sort(), [1, 2]);
  assert.ok(calls.length > 0 && calls.every(m => m === "claude-haiku-4-5"));
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(store.rows.map(r => r.wallet), [p.wallet]);
  assert.ok(store.rows[0]!.hands >= 1 && store.rows[0]!.ranked === false);
  assert.equal(chain.matches.length, 0, "practice never touches the chain");
  p.socket.close();
});

test("6 table: Shark, Maniac and Rock each think with their own model", async () => {
  calls.length = 0;
  const p = await player();
  p.send({ type: "practice_ai", mode: "six" });
  const table = await p.next(m => m.type === "table");
  assert.deepEqual(table.view.seats.map((s: any) => s.id).slice(1), ["ai:shark:1", "ai:maniac:1", "ai:rock:1", "ai:shark:2", "ai:maniac:2"]);
  await p.next(m => m.type === "finished", 40_000);
  assert.deepEqual([...new Set(calls)].sort(), ["claude-haiku-4-5", "llama3.1-8b", "openai-gpt-5-nano"]);
  p.socket.close();
});

test("no Cortex calls while the human is disconnected; AIs keep playing on rules", async () => {
  const p = await player();
  p.stopShoving();
  p.send({ type: "practice_ai", mode: "four" });
  await p.next(m => m.type === "seated");
  await new Promise(r => setTimeout(r, 50));
  p.socket.close();
  await new Promise(r => setTimeout(r, 100)); // let any in-flight decision land
  const before = calls.length;
  const tableId = [...server.tables.keys()].at(-1)!;
  const handBefore = server.tables.get(tableId)!.game.handNo;
  await new Promise(r => setTimeout(r, 1_500));
  assert.equal(calls.length, before, "no Cortex calls while the human is away");
  assert.ok(!server.tables.has(tableId) || server.tables.get(tableId)!.game.handNo > handBefore, "the table keeps playing");
});

test("a practice game ends as soon as the human busts", async () => {
  // A human who shoves every hand will bust or win quickly; either way the game must end promptly.
  const p = await player();
  p.send({ type: "practice_ai", mode: "six" });
  const done = await p.next(m => m.type === "finished", 30_000);
  assert.equal(Object.keys(done.places).length, 6);
  p.socket.close();
});

test("daily cap on AI practice games", async () => {
  const p = await player();
  // The previous tests used other wallets; this wallet gets 3 games.
  for (let i = 0; i < 3; i++) {
    p.send({ type: "practice_ai", mode: "heads_up" });
    await p.next(m => m.type === "finished" && !p.inbox.slice(0, p.inbox.indexOf(m)).some(x => x === m), 20_000);
    p.inbox.length = 0;
  }
  p.send({ type: "practice_ai", mode: "heads_up" });
  assert.match((await p.next(m => m.type === "error")).message, /today's AI practice games/);
  p.socket.close();
});
