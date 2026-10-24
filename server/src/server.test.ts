import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import WebSocket from "ws";
import { loginMessage } from "./auth.ts";
import { MemoryChain } from "./chain.ts";
import { startGameServer } from "./server.ts";
import { TIMING } from "./table.ts";

const PORT = 18_765;
const chain = new MemoryChain();
let server: ReturnType<typeof startGameServer>;

before(() => {
  Object.assign(TIMING, { betweenHandsMs: 20, showWindowMs: 20, turnMs: 400, timeBankMs: 200 });
  server = startGameServer({ port: PORT, chain });
});
after(() => server.close());

type Msg = { type: string; [k: string]: any };

/** A test client: a wallet keypair plus a socket that records every message. */
async function client(register: string[] = []) {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  for (const mode of register) chain.register(wallet, mode as never);
  const socket = new WebSocket(`ws://localhost:${PORT}`);
  const inbox: Msg[] = [];
  const waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  socket.on("message", data => {
    const m = JSON.parse(String(data)) as Msg;
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(m));
  });
  const next = (pred: (m: Msg) => boolean, timeoutMs = 5000) =>
    new Promise<Msg>((resolve, reject) => {
      const found = inbox.find(pred);
      if (found) return resolve(found);
      waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
    });
  const send = (m: object) => socket.send(JSON.stringify(m));
  const challenge = await next(m => m.type === "challenge");

  const signLogin = (nonce: string) => {
    const key = createPrivateKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        d: Buffer.from(kp.secretKey.slice(0, 32)).toString("base64url"),
        x: Buffer.from(kp.publicKey.toBytes()).toString("base64url"),
      },
      format: "jwk",
    });
    return sign(null, Buffer.from(loginMessage(nonce)), key).toString("base64");
  };
  const login = async () => {
    send({ type: "login", wallet, signature: signLogin(challenge.nonce) });
    return next(m => m.type === "welcome" || m.type === "error");
  };
  return { wallet, socket, inbox, next, send, login, signLogin, challenge };
}

test("rejects a bad signature and accepts the wallet's own", async () => {
  const c = await client();
  c.send({ type: "login", wallet: c.wallet, signature: c.signLogin("not-the-nonce") });
  assert.equal((await c.next(m => m.type === "error")).message, "Signature check failed.");
  c.inbox.length = 0;
  assert.equal((await c.login()).type, "welcome");
  c.socket.close();
});

test("must be logged in and registered on-chain to queue", async () => {
  const c = await client();
  c.send({ type: "queue", mode: "heads_up" });
  assert.match((await c.next(m => m.type === "error")).message, /Log in/);
  await c.login();
  c.inbox.length = 0;
  c.send({ type: "queue", mode: "heads_up" });
  assert.match((await c.next(m => m.type === "error")).message, /Register your wallet for heads_up/);
  c.socket.close();
});

test("two queued players get a table; cards stay private; spectators and chat work", async () => {
  const a = await client(["heads_up"]);
  const b = await client(["heads_up"]);
  await a.login();
  await b.login();
  a.send({ type: "queue", mode: "heads_up" });
  b.send({ type: "queue", mode: "heads_up" });
  const seated = await a.next(m => m.type === "seated");
  await b.next(m => m.type === "seated" && m.tableId === seated.tableId);

  const view = (await a.next(m => m.type === "table")).view;
  const mine = view.seats.find((s: any) => s.id === a.wallet);
  const theirs = view.seats.find((s: any) => s.id === b.wallet);
  assert.ok(mine.cards.every((c: any) => typeof c === "string"));
  assert.ok(theirs.cards.every((c: any) => c === null));

  const spectator = await client();
  spectator.send({ type: "watch", tableId: seated.tableId });
  const watched = (await spectator.next(m => m.type === "table")).view;
  assert.ok(watched.seats.flatMap((s: any) => s.cards).every((c: any) => c === null));

  a.send({ type: "chat", text: "gl hf" });
  for (const c of [a, b, spectator]) {
    assert.equal((await c.next(m => m.type === "chat")).text, "gl hf");
  }
  for (const c of [a, b, spectator]) c.socket.close();
});

test("a full heads-up game is played, finished, and settled with the committed seed", async () => {
  const a = await client(["heads_up"]);
  const b = await client(["heads_up"]);
  await a.login();
  await b.login();
  a.send({ type: "queue", mode: "heads_up" });
  b.send({ type: "queue", mode: "heads_up" });
  await a.next(m => m.type === "seated");

  // Both players shove or call every time it's their turn.
  for (const c of [a, b]) {
    c.socket.on("message", data => {
      const m = JSON.parse(String(data)) as Msg;
      if (m.type !== "table" || m.view.toAct !== c.wallet || !m.view.legal) return;
      const legal = m.view.legal;
      c.send({ type: "action", action: legal.canRaise ? { type: "raise", to: legal.maxRaiseTo } : legal.canCheck ? { type: "check" } : { type: "call" } });
    });
  }
  const done = await a.next(m => m.type === "finished", 15_000);
  assert.equal(done.settled, true);
  assert.deepEqual(Object.values(done.places).sort(), [1, 2]);

  const match = chain.matches.at(-1)!;
  assert.deepEqual(match.players.sort(), [a.wallet, b.wallet].sort());
  const seed = Buffer.from(done.seed, "hex");
  assert.deepEqual(Buffer.from(match.commitment), createHash("sha256").update(seed).digest());
  assert.deepEqual(Buffer.from(match.settled!.seed), seed);
  for (const c of [a, b]) c.socket.close();
});

test("a disconnected player is checked or folded automatically", async () => {
  const a = await client(["heads_up"]);
  const b = await client(["heads_up"]);
  await a.login();
  await b.login();
  a.send({ type: "queue", mode: "heads_up" });
  b.send({ type: "queue", mode: "heads_up" });
  const seated = await a.next(m => m.type === "seated");
  b.socket.close();
  // a keeps calling; b is blinded out and the game still reaches the end.
  a.socket.on("message", data => {
    const m = JSON.parse(String(data)) as Msg;
    if (m.type === "table" && m.view.toAct === a.wallet && m.view.legal) {
      const legal = m.view.legal;
      a.send({ type: "action", action: legal.canRaise ? { type: "raise", to: legal.maxRaiseTo } : legal.canCheck ? { type: "check" } : { type: "call" } });
    }
  });
  const done = await a.next(m => m.type === "finished" && m.tableId === seated.tableId, 15_000);
  assert.equal(done.places[a.wallet], 1);
  a.socket.close();
});

test("an idle player times out after their turn timer and time bank", async () => {
  const a = await client(["four"]);
  const b = await client(["four"]);
  const c = await client(["four"]);
  const d = await client(["four"]);
  for (const p of [a, b, c, d]) await p.login();
  for (const p of [a, b, c, d]) p.send({ type: "queue", mode: "four" });
  await a.next(m => m.type === "seated");
  const first = (await a.next(m => m.type === "table")).view.toAct;
  const started = Date.now();
  // Nobody acts: the first player is folded after turn (400 ms) + bank (200 ms).
  const moved = await a.next(m => m.type === "table" && m.view.toAct !== first);
  assert.ok(Date.now() - started >= 550, `acted after ${Date.now() - started} ms`);
  assert.equal(moved.view.seats.find((s: any) => s.id === first).folded, true);
  for (const p of [a, b, c, d]) p.socket.close();
});
