import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { decodeBase58, encodeBase58 } from "./base58.ts";
import { MemoryChain } from "./chain.ts";
import { expectedBps, ratingDeltas } from "./elo.ts";

// Same vectors as the Rust tests in anchor/programs/horns_elo/src/elo.rs and the on-chain runs.
test("Elo matches the on-chain program exactly", () => {
  assert.equal(expectedBps(0), 5000);
  assert.equal(expectedBps(400), 9091);
  assert.equal(expectedBps(-400), 909);
  assert.equal(expectedBps(5000), 9901);
  assert.deepEqual(ratingDeltas([1200, 1200], [1, 2]), [16, -16]);
  assert.deepEqual(ratingDeltas([1200, 1200], [1, 1]), [0, 0]);
  assert.deepEqual(ratingDeltas([1000, 1400], [1, 2]), [29, -29]);
  assert.deepEqual(ratingDeltas([1200, 1300, 1100], [2, 1, 3]), [0, 10, -10]);
  assert.deepEqual(ratingDeltas([1200, 1200, 1200, 1200], [2, 1, 3, 4]), [5, 16, -5, -16]);
});

test("base58 round-trips Solana addresses", () => {
  const address = "E4WuDUxqymTCF7rqQz4a4ZmVhWuQJe9Pbrmy7uia5Bbo";
  const bytes = decodeBase58(address);
  assert.equal(bytes.length, 32);
  assert.equal(encodeBase58(bytes), address);
  assert.equal(encodeBase58(new Uint8Array([0, 0, 1])), "112");
  assert.throws(() => decodeBase58("0OIl"));
});

test("the local chain behaves like the program", async () => {
  const chain = new MemoryChain();
  assert.equal(await chain.rating("a", "heads_up"), null);
  chain.register("a", "heads_up");
  chain.register("b", "heads_up");
  const seed = new Uint8Array(32).fill(9);
  const id = await chain.createMatch("heads_up", ["a", "b"], createHash("sha256").update(seed).digest());
  await assert.rejects(chain.settleMatch(id, "heads_up", ["a", "b"], [1, 2], new Uint8Array(32), new Uint8Array(32)), /seed/);
  await chain.settleMatch(id, "heads_up", ["a", "b"], [2, 1], seed, new Uint8Array(32));
  assert.equal(await chain.rating("a", "heads_up"), 1184);
  assert.equal(await chain.rating("b", "heads_up"), 1216);
  assert.equal(await chain.rating("a", "four"), null); // ratings are per mode
  await assert.rejects(chain.settleMatch(id, "heads_up", ["a", "b"], [2, 1], seed, new Uint8Array(32)), /already settled/);

  const auto = new MemoryChain({ autoRegister: true });
  assert.equal(await auto.rating("c", "six"), 1200);
});
