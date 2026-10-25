// npx tsx --test server/engine.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAction,
  continueAfterShowdown,
  createMatch,
  legalActions,
  publicMatch,
  stepRunout,
} from "./engine.js";
import { createHash } from "node:crypto";
import { cardCode } from "./poker.js";
import { MODE_SEATS, MODES, type MatchState } from "./types.js";

/** Plays the match to the end with random legal moves, fast-forwarding run-outs and showdowns. */
function playOut(match: MatchState, random: () => number) {
  const total = match.players.reduce((s, p) => s + p.stack, 0) + match.pot; // blinds are already in the pot
  for (let steps = 0; match.status === "playing"; steps++) {
    assert.ok(steps < 20_000, "match never finished");
    if (match.runoutAt) {
      match.runoutAt = 1; // long past: due now (0 means "no run-out")
      stepRunout(match);
      continue;
    }
    if (match.street === "showdown") {
      continueAfterShowdown(match);
      continue;
    }
    const actor = match.players[match.actionIndex!]!;
    const legal = legalActions(match, actor.walletId);
    const roll = random();
    if (roll < 0.15 && legal.canFold && !legal.canCheck) applyAction(match, actor.walletId, { type: "fold" });
    else if (roll < 0.35 && legal.maxRaiseTo > legal.minRaiseTo) {
      const to = legal.minRaiseTo + Math.floor(random() * (legal.maxRaiseTo - legal.minRaiseTo + 1));
      applyAction(match, actor.walletId, { type: "raise", raiseTo: to });
    } else applyAction(match, actor.walletId, { type: legal.canCheck ? "check" : "call" });
    const inPlay = match.players.reduce((s, p) => s + p.stack, 0) + match.pot;
    assert.equal(inPlay, total, "chips conserved mid-hand");
  }
  return total;
}

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("the seed stays secret until the match ends and matches its public commitment", () => {
  const match = createMatch("hands-up", ["w1", "w2"]);
  const view = publicMatch(match);
  assert.equal(view.revealSeed, null, "seed stays secret while playing");
  assert.equal(view.commitHash, createHash("sha256").update(Buffer.from(match.seed, "hex")).digest("hex"));
});

test("random full games: unique cards, chips conserved, valid places, seed revealed", () => {
  for (const mode of MODES) {
    for (let run = 0; run < 25; run++) {
      const n = MODE_SEATS[mode];
      const wallets = Array.from({ length: n }, (_, i) => `w${i}`);
      const match = createMatch(mode, wallets);
      const total = playOut(match, rng(run + n));
      assert.equal(match.players.reduce((s, p) => s + p.stack, 0), total);
      const places = wallets.map((w) => match.places[w]);
      assert.ok(places.every((p) => p !== undefined && p >= 1 && p <= n), `places ${places}`);
      assert.equal(places.filter((p) => p === 1).length, 1);
      assert.equal(publicMatch(match).revealSeed, match.seed);
    }
  }
});

test("cards dealt within a hand are all different", () => {
  const match = createMatch("sng-6", ["a", "b", "c", "d", "e", "f"]);
  const random = rng(9);
  for (let hand = 0; hand < 30 && match.status === "playing"; hand++) {
    const startHand = match.handNumber;
    while (match.status === "playing" && match.handNumber === startHand) {
      if (match.runoutAt) {
        match.runoutAt = 1; // long past: due now (0 means "no run-out")
        stepRunout(match);
      } else if (match.street === "showdown") {
        const seen = [...match.board, ...match.players.flatMap((p) => (p.busted && !p.hole ? [] : (p.hole ?? [])))].map(cardCode);
        assert.equal(new Set(seen).size, seen.length, `duplicate card in hand ${match.handNumber}`);
        continueAfterShowdown(match);
      } else {
        const actor = match.players[match.actionIndex!]!;
        const legal = legalActions(match, actor.walletId);
        applyAction(match, actor.walletId, { type: random() < 0.5 && legal.canCheck ? "check" : legal.canCall ? "call" : "check" });
      }
    }
  }
});
