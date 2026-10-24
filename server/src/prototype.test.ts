import { test } from "node:test";
import assert from "node:assert/strict";
import { startPrototype } from "./prototype.ts";
import { TIMING } from "./table.ts";

test("prototype: serves the page and bots play a 4-player game that settles locally", async () => {
  Object.assign(TIMING, { betweenHandsMs: 10, showWindowMs: 10 });
  const port = 18_900;
  const proto = startPrototype(port, { botThinkMs: 0 });
  try {
    const page = await (await fetch(`http://localhost:${port}/`)).text();
    assert.match(page, /<title>Game Prototype<\/title>/);

    const res = await fetch(`http://localhost:${port}/api/bots`, { method: "POST", body: JSON.stringify({ mode: "four", count: 4 }) });
    const { bots } = (await res.json()) as { bots: string[] };
    assert.equal(bots.length, 4);

    // Wait for the match to be created and settled.
    const deadline = Date.now() + 60_000;
    while (!proto.chain.matches[0]?.settled) {
      assert.ok(Date.now() < deadline, "game did not finish in time");
      await new Promise(r => setTimeout(r, 100));
    }
    const match = proto.chain.matches[0]!;
    assert.deepEqual([...match.players].sort(), [...bots].sort());
    assert.equal(match.settled!.places.filter(p => p === 1).length, 1);

    const state = (await (await fetch(`http://localhost:${port}/api/state`)).json()) as { ratings: { rating: number; games: number }[] };
    assert.equal(state.ratings.length, 4);
    assert.ok(state.ratings.every(r => r.games === 1));
    const total = state.ratings.reduce((sum, r) => sum + r.rating, 0);
    assert.ok(Math.abs(total - 4 * 1200) <= 2, `ratings should be (nearly) zero-sum, got ${total}`);
  } finally {
    await proto.close();
  }
});
