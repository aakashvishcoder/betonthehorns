import { test } from "node:test";
import assert from "node:assert/strict";
import { Matchmaker } from "./matchmaker.ts";

test("matches close ratings right away in the right mode", () => {
  const m = new Matchmaker();
  m.join("heads_up", "a", 1200, 0);
  m.join("four", "x", 1200, 0);
  m.join("heads_up", "b", 1250, 1000);
  assert.deepEqual(m.tick(1000), [{ mode: "heads_up", players: ["a", "b"] }]);
  assert.equal(m.waiting("heads_up"), 0);
  assert.equal(m.waiting("four"), 1);
});

test("the Elo range widens by 50 every 15 seconds of waiting", () => {
  const m = new Matchmaker();
  m.join("heads_up", "a", 1200, 0);
  m.join("heads_up", "b", 1420, 0); // 220 apart
  assert.deepEqual(m.tick(0), []); // ±100
  assert.deepEqual(m.tick(44_999), []); // ±200
  assert.deepEqual(m.tick(45_000), [{ mode: "heads_up", players: ["a", "b"] }]); // ±250
});

test("both players must accept the gap, so a newcomer's narrow range counts", () => {
  const m = new Matchmaker();
  m.join("heads_up", "veteran", 1200, 0);
  m.join("heads_up", "newcomer", 1400, 60_000);
  assert.deepEqual(m.tick(60_000), []); // veteran accepts ±300, newcomer only ±100
  assert.equal(m.tick(105_000).length, 1); // newcomer now ±250
});

test("a table only forms when everyone is within everyone's range", () => {
  const m = new Matchmaker();
  m.join("four", "a", 1200, 0);
  m.join("four", "b", 1290, 0);
  m.join("four", "c", 1110, 0); // 180 from b
  m.join("four", "d", 1200, 0);
  assert.deepEqual(m.tick(0), []);
  m.join("four", "e", 1150, 0);
  const [table] = m.tick(0);
  assert.deepEqual(table!.players.sort(), ["a", "c", "d", "e"]); // b would be 180 from c
  assert.equal(m.waiting("four"), 1);
});

test("forms several tables in one tick and keeps the rest queued", () => {
  const m = new Matchmaker();
  for (let i = 0; i < 13; i++) m.join("six", `p${i}`, 1200 + (i % 3) * 10, i);
  const tables = m.tick(100);
  assert.equal(tables.length, 2);
  assert.equal(new Set(tables.flatMap(t => t.players)).size, 12);
  assert.equal(m.waiting("six"), 1);
});

test("a player can be in one queue at a time and can leave", () => {
  const m = new Matchmaker();
  m.join("six", "a", 1200, 0);
  assert.throws(() => m.join("four", "a", 1200, 0), /already queued/);
  assert.equal(m.modeOf("a"), "six");
  m.leave("a");
  assert.equal(m.modeOf("a"), undefined);
  m.join("four", "a", 1200, 0);
});
