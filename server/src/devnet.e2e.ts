// Full game on devnet: two bot wallets register, queue, play heads-up, and get settled on-chain.
//   npm run test:devnet
// Needs ~/.config/solana/id.json (funded deployer) and ~/.config/solana/horns-elo-server.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, clusterApiUrl, sendAndConfirmTransaction } from "@solana/web3.js";
import WebSocket from "ws";
import { loginMessage } from "./auth.ts";
import { startGameServer } from "./server.ts";
import { SolanaChain, readRating, registerPlayerIx } from "./solana-chain.ts";
import { TIMING } from "./table.ts";

const keypair = (name: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/${name}`, "utf8"))));

function signLogin(kp: Keypair, nonce: string) {
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
}

/** A bot that logs in, queues, and shoves or calls on every turn. Resolves with the "finished" message. */
function bot(kp: Keypair, port: number) {
  return new Promise<any>((resolve, reject) => {
    const socket = new WebSocket(`ws://localhost:${port}`);
    const wallet = kp.publicKey.toBase58();
    socket.on("message", data => {
      const m = JSON.parse(String(data));
      if (m.type === "challenge") socket.send(JSON.stringify({ type: "login", wallet, signature: signLogin(kp, m.nonce) }));
      if (m.type === "welcome") socket.send(JSON.stringify({ type: "queue", mode: "heads_up" }));
      if (m.type === "error") reject(new Error(m.message));
      if (m.type === "table" && m.view.toAct === wallet && m.view.legal) {
        const l = m.view.legal;
        const action = l.canRaise ? { type: "raise", to: l.maxRaiseTo } : l.canCheck ? { type: "check" } : { type: "call" };
        socket.send(JSON.stringify({ type: "action", action }));
      }
      if (m.type === "finished") {
        socket.close();
        resolve(m);
      }
    });
  });
}

test("two bots play a heads-up Sit & Go that settles on devnet", { timeout: 180_000 }, async () => {
  Object.assign(TIMING, { betweenHandsMs: 200, showWindowMs: 200 });
  const connection = new Connection(process.env.SOLANA_RPC ?? clusterApiUrl("devnet"), "confirmed");
  const deployer = keypair("id.json");
  const serverKey = keypair("horns-elo-server.json");
  const bots = [Keypair.generate(), Keypair.generate()];

  const funding = new Transaction().add(
    ...bots.map(b => SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: b.publicKey, lamports: LAMPORTS_PER_SOL / 100 })),
  );
  if ((await connection.getBalance(serverKey.publicKey)) < LAMPORTS_PER_SOL / 50) {
    funding.add(SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: serverKey.publicKey, lamports: LAMPORTS_PER_SOL / 20 }));
  }
  await sendAndConfirmTransaction(connection, funding, [deployer]);
  for (const b of bots) {
    await sendAndConfirmTransaction(connection, new Transaction().add(registerPlayerIx(b.publicKey, "heads_up")), [deployer, b]);
    assert.deepEqual(await readRating(connection, b.publicKey, "heads_up"), { rating: 1200, games: 0, wins: 0 });
  }
  console.log("bots registered:", bots.map(b => b.publicKey.toBase58()).join(", "));

  const port = 18_800;
  const logs: string[] = [];
  const server = startGameServer({ port, chain: new SolanaChain(connection, serverKey), log: m => (logs.push(m), console.log(" ", m)) });
  try {
    const [done] = await Promise.all(bots.map(b => bot(b, port)));
    assert.equal(done.settled, true, logs.join("\n"));

    const results = await Promise.all(bots.map(b => readRating(connection, b.publicKey, "heads_up")));
    const winner = bots.findIndex(b => done.places[b.publicKey.toBase58()] === 1);
    console.log("places:", done.places, "on-chain ratings:", results);
    assert.deepEqual(results[winner], { rating: 1216, games: 1, wins: 1 });
    assert.deepEqual(results[1 - winner], { rating: 1184, games: 1, wins: 0 });
  } finally {
    await server.close();
  }
});
