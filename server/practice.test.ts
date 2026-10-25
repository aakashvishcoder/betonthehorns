// npx tsx --test server/practice.test.ts   (no database, Ably or Snowflake needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, continueAfterShowdown, createMatch, legalActions, stepRunout } from "./engine.js";
import {
  AI_TIMING,
  driveAi,
  finishTracking,
  practiceSeats,
  registerPractice,
  styleStore,
  syncHands,
  trackAction,
} from "./practice.js";
import { issueChallenge, login, sessionWallet } from "./session.js";
import { MemoryStyleStore } from "./src/ai/style-store.ts";
import { fakeWallet } from "./src/wallet.ts";
import type { ActionInput, MatchState } from "./types.js";

AI_TIMING.thinkMs = [0, 0];
const settle = () => new Promise((r) => setTimeout(r, 5));

/** Runs a practice table: the human always shoves/calls; AIs act through driveAi. */
async function play(match: MatchState, human: string) {
  const act = async (walletId: string, input: ActionInput) => {
    trackAction(match, walletId, input);
    applyAction(match, walletId, input);
    syncHands(match);
  };
  for (let steps = 0; match.status === "playing"; steps++) {
    assert.ok(steps < 5_000, "practice game never finished");
    syncHands(match);
    if (match.runoutAt) {
      match.runoutAt = 1;
      stepRunout(match);
      continue;
    }
    if (match.street === "showdown") {
      continueAfterShowdown(match);
      continue;
    }
    const actor = match.players[match.actionIndex!]!;
    if (actor.walletId === human) {
      const l = legalActions(match, human);
      await act(human, l.maxRaiseTo > match.currentBet ? { type: "raise", raiseTo: l.maxRaiseTo } : { type: l.canCheck ? "check" : "call" });
    } else {
      driveAi(match, act);
      await settle();
    }
  }
}

test("practice: AI seats play a full game against the human, then style is saved for the human only", async () => {
  const human = fakeWallet().address;
  const { ids, players } = await practiceSeats(human, "sng-4", 4, 1200);
  assert.deepEqual(ids, ["ai:shark:1", "ai:maniac:1", "ai:rock:1"]);
  const match = createMatch("sng-4", [human], ids, { ranked: false });
  registerPractice(match, players);
  assert.equal(match.ranked, false);
  assert.ok(match.players.filter((p) => p.bot).length === 3);

  await play(match, human);
  assert.equal(match.status, "finished");
  assert.equal(Object.keys(match.places).length, 4, "everyone gets a place");
  const humanSeat = match.players.find((p) => p.walletId === human)!;
  if (humanSeat.busted) assert.ok(match.players.filter((p) => !p.busted).length >= 1, "ended as soon as the human busted");

  await finishTracking(match);
  const rows = (styleStore as MemoryStyleStore).rows;
  assert.deepEqual(rows.map((r) => r.wallet), [human]);
  assert.ok(rows[0]!.hands >= 1 && rows[0]!.ranked === false && rows[0]!.mode === "four");
  const style = await styleStore.styleOf(human);
  assert.ok(style && style.vpip > 0.9, "a player who shoves every hand is very loose");
});

test("practice ends the moment the human busts, placing AIs by chips", () => {
  const match = createMatch("sng-4", ["human"], ["ai:shark:1", "ai:maniac:1", "ai:rock:1"], { ranked: false });
  // Force the human to bust at the next showdown.
  const human = match.players[0]!;
  human.stack = 0;
  match.street = "showdown";
  continueAfterShowdown(match);
  assert.equal(match.status, "finished");
  assert.equal(match.places.human, 4);
  assert.deepEqual(Object.values(match.places).sort(), [1, 2, 3, 4].slice(0, Object.keys(match.places).length).sort());
});

test("signed login: only a valid wallet signature gets a session", () => {
  const w = fakeWallet();
  const req = (token?: string) => ({ header: (name: string) => (name === "authorization" && token ? `Bearer ${token}` : undefined) }) as never;

  const { nonce } = issueChallenge(w.address);
  assert.equal(login(w.address, w.signLogin("not-the-nonce")), null, "wrong message");
  // A failed attempt burns the challenge.
  assert.equal(login(w.address, w.signLogin(nonce)), null, "challenge is single-use");

  const second = issueChallenge(w.address);
  const other = fakeWallet();
  assert.equal(login(w.address, other.signLogin(second.nonce)), null, "someone else's signature");

  const third = issueChallenge(w.address);
  const session = login(w.address, w.signLogin(third.nonce))!;
  assert.ok(session.token.length >= 40);
  assert.equal(sessionWallet(req(session.token)), w.address);
  assert.equal(sessionWallet(req("forged-token")), null);
  assert.equal(sessionWallet(req()), null);
});
