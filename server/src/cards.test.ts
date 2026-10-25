import { test } from "node:test";
import assert from "node:assert/strict";
import { FULL_DECK, shuffledDeck } from "./cards.ts";
import { evaluate } from "./evaluate.ts";

const seed = new Uint8Array(32).fill(7);

test("shuffle is a permutation, repeatable, and different per hand", () => {
  const a = shuffledDeck(seed, 1);
  assert.deepEqual([...a].sort(), [...FULL_DECK].sort());
  assert.deepEqual(shuffledDeck(seed, 1), a);
  assert.notDeepEqual(shuffledDeck(seed, 2), a);
  assert.notDeepEqual(shuffledDeck(new Uint8Array(32).fill(8), 1), a);
});

test("shuffle has no obvious position bias", () => {
  // Over 4,000 hands the ace of spades should land in the top 13 cards ~1/4 of the time.
  let top = 0;
  for (let h = 0; h < 4000; h++) if (shuffledDeck(seed, h).indexOf("As") < 13) top++;
  assert.ok(top > 850 && top < 1150, `ace of spades on top quarter ${top} / 4000`);
});

const hand = (s: string) => s.split(" ");
const name = (s: string) => evaluate(hand(s)).name;
const beats = (a: string, b: string) => evaluate(hand(a)).score > evaluate(hand(b)).score;
const ties = (a: string, b: string) => evaluate(hand(a)).score === evaluate(hand(b)).score;

test("names every category from seven cards", () => {
  assert.equal(name("As Ks Qs Js Ts 2d 3c"), "Straight flush");
  assert.equal(name("9h 9d 9s 9c 2d 3c 4h"), "Four of a kind");
  assert.equal(name("9h 9d 9s 2c 2d 3c 4h"), "Full house");
  assert.equal(name("2h 7h 9h Jh Kh 3c 4d"), "Flush");
  assert.equal(name("5d 6c 7h 8s 9d Kc 2h"), "Straight");
  assert.equal(name("Ad 2c 3h 4s 5d Kc 9h"), "Straight");
  assert.equal(name("9h 9d 9s 2c 5d Kc 4h"), "Three of a kind");
  assert.equal(name("9h 9d 2s 2c 5d Kc 4h"), "Two pair");
  assert.equal(name("9h 9d 2s 3c 5d Kc 7h"), "Pair");
  assert.equal(name("9h Jd 2s 3c 5d Kc 7h"), "High card");
});

test("ranks hands and kickers correctly", () => {
  assert.ok(beats("Ad 2c 3h 4s 5d 6c 9h", "Ad 2c 3h 4s 5d Kc 9h")); // 6-high straight beats the wheel
  assert.ok(beats("Ah Ad Ks 2c 3d 7c 8h", "Ah Ad Qs 2c 3d 7c 8h")); // kicker
  assert.ok(beats("Kh Kd Ks 2c 2d", "Qh Qd Qs Ac Ad")); // full house by trips
  assert.ok(beats("9h 9d 9s 2c 2d 3c 3h", "9h 9d 9s 2c 2d Ac 4h")); // best pair in a double-full
  assert.ok(beats("2h 3h 4h 5h 7h", "As Ks Qd Jc Th")); // flush beats straight
  assert.ok(ties("As Kd 7c 7d 2s 3h 4c", "Ac Kh 7s 7h 2c 3d 4s")); // split pot
  assert.ok(beats("As Ks Qs Js Ts", "Ks Qs Js Ts 9s")); // royal over king-high straight flush
  assert.ok(beats("Tc Th 4d 4s Ac", "Tc Th 4d 4s Kc")); // two pair kicker
});
