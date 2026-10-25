// npx tsx --test server/puzzles.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HAND_CLASSES,
  chen,
  dailyPuzzles,
  preflopEquity,
  publicPuzzle,
  topRange,
  turnEquityExact,
} from "./puzzles.js";

test("hand ranking: 169 classes covering all 1,326 combos, best hands first", () => {
  assert.equal(HAND_CLASSES.length, 169);
  assert.deepEqual(HAND_CLASSES.slice(0, 3), ["AA", "KK", "QQ"]);
  assert.equal(topRange(1, []).length, 1326);
  assert.equal(topRange(1, ["As"]).length, 1326 - 51, "dead cards are removed");
  assert.ok(chen(14, 13, true) > chen(7, 2, false));
  const top10 = topRange(0.1, []);
  assert.ok(top10.length >= 120 && top10.length <= 150);
});

test("equity sanity: known matchups", () => {
  // Nut flush draw on the turn vs a set: 8 outs-ish... exact enumeration, both directions sum to 1.
  const hero = ["Ah", "Kh"], board = ["Qh", "7h", "2c", "9s"];
  const villain: [string, string][] = [["Qc", "Qd"]];
  const eq = turnEquityExact(hero, board, villain);
  const back = turnEquityExact(["Qc", "Qd"], board, [["Ah", "Kh"]]);
  assert.ok(Math.abs(eq + back - 1) < 1e-9);
  assert.ok(eq > 0.15 && eq < 0.3, `flush draw vs set ${eq}`);
  // AA vs a random-ish wide range wins well over 80%.
  let s = 1;
  const random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  assert.ok(preflopEquity(["As", "Ad"], topRange(1, ["As", "Ad"]), 5_000, random) > 0.8);
});

test("the same day always gives the same five puzzles, easy to hard", () => {
  const a = dailyPuzzles("2026-01-01");
  const b = dailyPuzzles("2026-01-01");
  assert.equal(a, b, "cached");
  assert.deepEqual(a.map((p) => p.difficulty), ["easy", "easy", "medium", "hard", "hard"]);
  assert.deepEqual(a.map((p) => p.id), ["2026-01-01#1", "2026-01-01#2", "2026-01-01#3", "2026-01-01#4", "2026-01-01#5"]);
  assert.notDeepEqual(dailyPuzzles("2026-01-02").map((p) => p.hero), a.map((p) => p.hero));
});

test("puzzles are well formed and the browser never sees the answer", () => {
  for (const day of ["2026-02-10", "2026-03-15", "2026-04-20"]) {
    for (const p of dailyPuzzles(day)) {
      const cards = [...p.hero, ...p.board];
      assert.equal(new Set(cards).size, cards.length, "no duplicate cards");
      assert.ok(cards.every((c) => /^[2-9TJQKA][SHDC]$/.test(c)), `card codes ${cards}`);
      assert.ok(p.options.some((o) => o.id === p.solution.answer), "the answer is one of the options");
      assert.ok(p.solution.explanation.length > 40 && p.solution.numbers.length >= 2);
      const view = JSON.stringify(publicPuzzle(p));
      assert.ok(!view.includes("solution") && !view.includes(p.solution.explanation), "no answer in the public view");
    }
  }
});
