// npx tsx --test server/analysis.test.ts   (no database or Snowflake needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeMatch, draws } from "./analysis.js";
import { applyAction, continueAfterShowdown, createMatch, legalActions, stepRunout } from "./engine.js";
import { liveHands, recordAction, syncHistory, viewFor, type MatchHistory } from "./history.js";
import type { ActionInput, MatchState } from "./types.js";

/** Plays a heads-up match (A always shoves, B always calls) through the recorder. */
function playRecorded(): MatchState {
  const match = createMatch("hands-up", ["A".repeat(32), "B".repeat(32)]);
  const act = (walletId: string, input: ActionInput) => {
    recordAction(match, walletId, input);
    applyAction(match, walletId, input);
    syncHistory(match);
  };
  for (let steps = 0; match.status === "playing" && steps < 5_000; steps++) {
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
    const actor = match.players[match.actionIndex!]!;
    const l = legalActions(match, actor.walletId);
    act(actor.walletId, actor.walletId.startsWith("A") && l.maxRaiseTo > match.currentBet
      ? { type: "raise", raiseTo: l.maxRaiseTo }
      : { type: l.canCheck ? "check" : "call" });
  }
  return match;
}

test("hand history records every decision with pot, price and stack", () => {
  const match = playRecorded();
  assert.equal(match.status, "finished");
  const hands = liveHands(match.id);
  assert.ok(hands.length >= 1);
  for (const h of hands) {
    assert.equal(Object.keys(h.holes).length, 2, "both players' cards stored server-side");
    assert.ok(h.actions.length >= 1);
    assert.equal(Object.values(h.stacks).reduce((s, x) => s + x, 0), 2_000, "starting stacks include posted blinds");
    assert.ok(h.winners.length >= 1, `hand ${h.hand} has a result`);
    assert.ok(h.actions.every((a) => a.pot >= 0 && a.toCall >= 0 && a.stack >= 0));
  }
  // A shove that got called runs out the board and shows both hands.
  const showdown = hands.find((h) => h.shown.length === 2);
  assert.ok(showdown && showdown.board.length === 5);
});

test("the analysis prompt only shows cards the player could have seen", () => {
  const me = "A".repeat(32), opp = "B".repeat(32);
  const hand = (n: number, shown: string[]) => ({
    hand: n, blinds: { sb: 10, bb: 20 }, dealer: me, stacks: { [me]: 1000, [opp]: 1000 },
    holes: { [me]: ["AS", "KS"], [opp]: ["QD", "QC"] }, board: ["2H", "7D", "9C", "JS", "3H"],
    actions: [
      { street: "preflop", player: me, action: "raise", raiseTo: 60, pot: 30, toCall: 10, stack: 990 },
      { street: "preflop", player: opp, action: "fold", pot: 90, toCall: 40, stack: 980 },
    ],
    shown, winners: [{ player: me, amount: 90 }],
  });
  const history: MatchHistory = { matchId: "m", mode: "hands-up", players: [me, opp], places: { [me]: 1, [opp]: 2 }, hands: [hand(1, []), hand(2, [me, opp])] };
  const text = describeMatch(viewFor(history, me), me);
  const [first, second] = text.split("Hand 2");
  assert.match(first!, /You As Ks/);
  assert.doesNotMatch(first!, /QD/, "folded opponent's cards stay hidden");
  assert.match(second!, /Opp1 Qd Qc/, "cards shown at showdown are known");
  assert.match(second!, /final hands: You Ace high, Opp1 Pair of queens|final hands: You .*, Opp1 .*queens/i);
  assert.match(text, /You raise to 3bb \(pot 1\.5bb, to call 0\.5bb, stack 49\.5bb\)/);
  assert.match(text, /finished place 1 of 2/);
});

test("draws are named with exact outs, and stay live on the turn", () => {
  assert.equal(draws(["AS", "8S"], ["KD", "JS", "4S"]), "flush draw (9 outs)");
  assert.equal(draws(["AS", "8S"], ["KD", "JS", "4S", "7D"]), "flush draw (9 outs)", "the turn bricked; still a draw");
  assert.equal(draws(["AS", "8S"], ["KD", "JS", "4S", "7D", "2C"]), null, "no draws on the river");
  assert.equal(draws(["9H", "8C"], ["7D", "6S", "2C"]), "open-ended straight draw (8 outs)");
  assert.equal(draws(["9H", "8C"], ["6D", "5S", "2C"]), "gutshot straight draw (4 outs)");
  // Ten of hearts makes both: 9 flush outs + 4 straight outs, 12 different cards.
  assert.equal(draws(["AH", "KH"], ["QH", "JH", "2C"]), "flush draw (9 outs) + gutshot straight draw (4 outs), 12 outs total");
  // A straight or flush that would be all on the board doesn't count.
  assert.equal(draws(["2C", "3D"], ["9H", "TH", "JH", "QD"]), null);
  assert.equal(draws(["KC", "KD"], ["KH", "7S", "2D"]), null, "a set has no straight/flush draw");
});
