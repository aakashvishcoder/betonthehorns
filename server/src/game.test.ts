import { test } from "node:test";
import assert from "node:assert/strict";
import { FULL_DECK, type Card } from "./cards.ts";
import { SitAndGo } from "./game.ts";

const zeroSeed = new Uint8Array(32); // first button = seat 0

/**
 * Deck for one hand: hole cards in deal order (starting left of the button,
 * one card per player per round), then burn/flop/burn/turn/burn/river.
 */
function deck(holes: string[], board: string): Card[] {
  const h = holes.map(s => s.split(" "));
  const b = board.split(" ");
  const top = [...h.map(c => c[0]!), ...h.map(c => c[1]!), "Xx", b[0]!, b[1]!, b[2]!, "Xx", b[3]!, "Xx", b[4]!];
  return [...top, ...FULL_DECK.filter(c => !top.includes(c))];
}

function game(ids: string[], stacks?: number[], decks?: Card[][]) {
  const g = new SitAndGo({
    playerIds: ids,
    seed: zeroSeed,
    startedAt: 0,
    deckFor: decks ? hand => decks[(hand - 1) % decks.length]! : undefined,
  });
  stacks?.forEach((s, i) => (g.seats[i]!.stack = s));
  return g;
}

const stacks = (g: SitAndGo) => g.seats.map(s => s.stack);

test("heads-up: button posts small blind, acts first preflop and last after", () => {
  const g = game(["a", "b"]);
  g.startHand(0);
  assert.equal(g.button, 0);
  assert.deepEqual(g.seats.map(s => s.bet), [10, 20]);
  assert.equal(g.view().toAct, "a");
  g.act("a", { type: "call" });
  assert.equal(g.view().toAct, "b"); // big blind's option
  g.act("b", { type: "check" });
  assert.equal(g.street, "flop");
  assert.equal(g.board.length, 3);
  assert.equal(g.view().toAct, "b");
});

test("players only see their own hole cards", () => {
  const g = game(["a", "b", "c"]);
  g.startHand(0);
  const view = g.view("b");
  assert.equal(view.seats[1]!.cards.every(c => c !== null), true);
  assert.equal(view.seats[0]!.cards.every(c => c === null), true);
  assert.equal(g.view().seats.flatMap(s => s.cards).every(c => c === null), true); // spectator
});

test("uncontested winner takes the pot and may choose to show", () => {
  const g = game(["a", "b", "c"]);
  g.startHand(0); // button a, SB b, BB c, a acts first
  g.act("a", { type: "raise", to: 60 });
  g.act("b", { type: "fold" });
  g.act("c", { type: "fold" });
  assert.deepEqual(stacks(g), [1530, 1490, 1480]);
  assert.equal(g.view("a").canShow, true);
  assert.equal(g.view().seats[0]!.cards.every(c => c === null), true);
  g.show("a");
  assert.equal(g.view().seats[0]!.cards.every(c => c !== null), true);
});

test("enforces minimum raises and turn order", () => {
  const g = game(["a", "b", "c"]);
  g.startHand(0);
  assert.throws(() => g.act("b", { type: "fold" }), /not your turn/);
  assert.throws(() => g.act("a", { type: "raise", to: 30 }), /between 40 and 1500/);
  g.act("a", { type: "raise", to: 60 }); // raise of 40
  assert.equal(g.legal("b").minRaiseTo, 100);
  assert.throws(() => g.act("b", { type: "raise", to: 80 }));
  assert.throws(() => g.act("b", { type: "check" }), /cannot check/);
});

test("short all-in raise does not reopen raising for players who already acted", () => {
  // a (button, UTG 3-handed) raises to 60; b shoves 80 total (only +20); c can still raise, a may only call or fold.
  const g = game(["a", "b", "c"], [1500, 80, 1500]);
  g.startHand(0);
  g.act("a", { type: "raise", to: 60 });
  g.act("b", { type: "raise", to: 80 });
  assert.equal(g.legal("c").canRaise, true);
  g.act("c", { type: "call" });
  assert.equal(g.view().toAct, "a");
  assert.equal(g.legal("a").canRaise, false);
  assert.equal(g.legal("a").toCall, 20);
});

test("side pots: short stack wins the main pot, middle stack the side pot", () => {
  // Deal order starts left of the button: b, c, a.
  const d = deck(["Kh Kd", "7c 2d", "As Ad"], "3s 8h 9c Jd 4c");
  const g = game(["a", "b", "c"], [300, 800, 1500], [d]);
  g.startHand(0);
  g.act("a", { type: "raise", to: 300 });
  g.act("b", { type: "raise", to: 800 });
  g.act("c", { type: "call" });
  assert.equal(g.street, "done");
  assert.equal(g.board.length, 5);
  assert.deepEqual(stacks(g), [900, 1000, 700]);
  assert.deepEqual(
    g.lastResult.map(p => [p.amount, p.winners]),
    [
      [900, ["a"]],
      [1000, ["b"]],
    ],
  );
  assert.equal(g.view().seats.every(s => s.cards.every(c => c !== null)), true); // called hands shown
});

test("identical hands split the pot", () => {
  // Board plays: broadway on the board for everyone.
  const d = deck(["2c 3d", "2h 3s"], "Ts Jh Qd Kc Ac");
  const g = game(["a", "b"], undefined, [d]);
  g.startHand(0);
  g.act("a", { type: "call" });
  g.act("b", { type: "check" });
  for (const street of ["flop", "turn", "river"]) {
    assert.equal(g.street, street);
    g.act("b", { type: "check" });
    g.act("a", { type: "check" });
  }
  assert.deepEqual(stacks(g), [1500, 1500]);
  assert.equal(g.lastResult[0]!.hand, "Straight");
});

test("same-hand busts: bigger starting stack places higher, equal stacks tie", () => {
  // Button a, SB b, BB c, d first to act. Deal order b, c, d, a; d holds aces and covers everyone.
  const d = deck(["Kh Kd", "Qh Qd", "As Ad", "2c 7d"], "3s 8h 9c Jd 4c");
  const g = game(["a", "b", "c", "d"], [1500, 100, 200, 1500], [d]);
  g.startHand(0);
  g.act("d", { type: "call" });
  g.act("a", { type: "fold" });
  g.act("b", { type: "raise", to: 100 });
  g.act("c", { type: "raise", to: 200 });
  g.act("d", { type: "call" });
  assert.deepEqual(g.view().places, { c: 3, b: 4 });

  const t = game(["a", "b", "c", "d"], [1500, 150, 150, 1500], [d]);
  t.startHand(0);
  t.act("d", { type: "call" });
  t.act("a", { type: "fold" });
  t.act("b", { type: "raise", to: 150 });
  t.act("c", { type: "call" });
  t.act("d", { type: "call" });
  assert.deepEqual(t.view().places, { b: 3, c: 3 });
});

test("folded small blind gets back chips no one could match", () => {
  // Everyone else is all-in for 7; the small blind's extra 3 chips go back to it.
  const g = game(["a", "b", "c"], [7, 1480, 7]);
  g.startHand(0); // button a, SB b posts 10, BB c all-in for 7
  g.act("a", { type: "call" });
  g.act("b", { type: "fold" });
  assert.equal(stacks(g).reduce((x, y) => x + y, 0), 1494);
  assert.equal(g.seats[1]!.stack, 1473);
});

test("blinds double every five minutes", () => {
  const g = game(["a", "b"]);
  g.startHand(11 * 60_000);
  assert.deepEqual(g.view().blinds, [40, 80]);
});

// Small seeded PRNG so the fuzz test is repeatable.
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("random full Sit & Gos conserve chips and finish with valid places", () => {
  for (const players of [2, 4, 6]) {
    for (let run = 0; run < 40; run++) {
      const random = rng(run * 7 + players);
      const ids = Array.from({ length: players }, (_, i) => `p${i}`);
      const g = new SitAndGo({ playerIds: ids, seed: new Uint8Array(32).fill(run), startedAt: 0 });
      const total = 1500 * players;
      let hands = 0;
      while (!g.finished) {
        g.startHand(hands++ * 60_000); // blinds rise every 5 hands
        while (g.street !== "done") {
          const id = g.view().toAct!;
          const legal = g.legal(id);
          const roll = random();
          if (roll < 0.15 && !legal.canCheck) g.act(id, { type: "fold" });
          else if (roll < 0.35 && legal.canRaise) {
            const to = legal.minRaiseTo + Math.floor(random() * (legal.maxRaiseTo - legal.minRaiseTo + 1));
            g.act(id, { type: "raise", to });
          } else g.act(id, legal.canCheck ? { type: "check" } : { type: "call" });
          // Mid-hand, chips are either in stacks or in the pot (once the hand ends the pot is paid out).
          const inPot = g.view().street === "done" ? 0 : g.pot;
          assert.equal(stacks(g).reduce((a, b) => a + b, 0) + inPot, total);
        }
        assert.equal(stacks(g).reduce((a, b) => a + b, 0), total, `chips leaked in hand ${hands}`);
        assert.ok(hands < 500, "game did not finish");
      }
      const places = Object.values(g.view().places);
      assert.equal(places.length, players);
      assert.equal(places.filter(p => p === 1).length, 1);
      assert.ok(places.every(p => p >= 1 && p <= players));
      assert.equal(g.seats.filter(s => s.stack === total).length, 1);
    }
  }
});
