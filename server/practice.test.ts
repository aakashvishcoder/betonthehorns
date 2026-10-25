// npx tsx --test server/practice.test.ts   (no database, Ably or Snowflake needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, continueAfterShowdown, createMatch, legalActions, stepRunout } from "./engine.js";
import { recordAction, syncHistory } from "./history.js";
import { AI_TIMING, aiToAct, decideAi, finishTracking, practiceSeats, styleStore } from "./practice.js";
import { issueChallenge, login, sessionWallet } from "./session.js";
import { MemoryStyleStore } from "./src/ai/style-store.ts";
import { fakeWallet } from "./src/wallet.ts";
import type { ActionInput, MatchState } from "./types.js";

AI_TIMING.thinkMs = 0;

/** Runs a practice table the way the server does: the human always shoves/calls, AIs act when due. */
async function play(match: MatchState, human: string) {
  const act = (walletId: string, input: ActionInput) => {
    recordAction(match, walletId, input);
    applyAction(match, walletId, input);
    syncHistory(match);
  };
  for (let steps = 0; match.status === "playing"; steps++) {
    assert.ok(steps < 5_000, "practice game never finished");
    syncHistory(match);
    if (match.runoutAt) {
      match.runoutAt = 1;
      stepRunout(match);
      continue;
    }
    if (match.street === "showdown") {
      continueAfterShowdown(match);
      continue;
    }
    const ai = aiToAct(match);
    if (ai) {
      act(ai, await decideAi(match, ai));
      continue;
    }
    const l = legalActions(match, human);
    act(human, l.maxRaiseTo > match.currentBet ? { type: "raise", raiseTo: l.maxRaiseTo } : { type: l.canCheck ? "check" : "call" });
  }
}

test("practice: AI seats play a full game from match state alone, then style is saved for the human only", async () => {
  const human = fakeWallet().address;
  const { ids, ai } = await practiceSeats(human, "sng-4", 4, 1200);
  assert.deepEqual(ids, ["ai:shark:1", "ai:maniac:1", "ai:rock:1"]);
  const match = createMatch("sng-4", [human], ids, { ranked: false });
  match.ai = JSON.parse(JSON.stringify(ai)); // as it comes back from live_state
  assert.equal(match.ranked, false);

  await play(match, human);
  assert.equal(match.status, "finished");
  assert.ok((match.history?.length ?? 0) >= 1, "hands recorded in the match");

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

test("signed login: stateless tokens only for a valid wallet signature", () => {
  const w = fakeWallet();
  const req = (token?: string) => ({ header: (name: string) => (name === "authorization" && token ? `Bearer ${token}` : undefined) });

  const { nonce } = issueChallenge(w.address);
  assert.equal(login(w.address, w.signLogin("not-the-nonce"), nonce), null, "signed the wrong message");
  assert.equal(login(w.address, fakeWallet().signLogin(nonce), nonce), null, "someone else's signature");
  const [random, expires] = nonce.split(".");
  const forged = `${random}.${Number(expires) + 3_600_000}.${nonce.split(".")[2]}`;
  assert.equal(login(w.address, w.signLogin(forged), forged), null, "a challenge with a changed expiry");
  const other = issueChallenge(fakeWallet().address).nonce;
  assert.equal(login(w.address, w.signLogin(other), other), null, "a challenge issued to another wallet");

  const session = login(w.address, w.signLogin(nonce), nonce)!;
  assert.ok(session.token.length >= 40);
  assert.equal(sessionWallet(req(session.token)), w.address);
  const [, exp, mac] = session.token.split(".");
  assert.equal(sessionWallet(req(`${fakeWallet().address}.${exp}.${mac}`)), null, "token moved to another wallet");
  assert.equal(sessionWallet(req("forged-token")), null);
  assert.equal(sessionWallet(req()), null);
});
