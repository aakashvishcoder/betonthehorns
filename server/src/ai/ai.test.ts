import { test } from "node:test";
import assert from "node:assert/strict";
import { SitAndGo } from "../game.ts";
import { AiPlayer, viewFromSitAndGo } from "./ai-player.ts";
import { cortexMove, parseMove } from "./cortex.ts";
import { PERSONAS, aiName, aiSeats, personaOf } from "./personas.ts";
import { legalize, ruleMove } from "./policy.ts";
import { equity } from "./strength.ts";
import { StatsTracker, blendStyle, defaultStyleForElo, skillFromElo, styleFromStats } from "./style.ts";

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("equity: aces dominate, junk is weak, the nuts on the river always wins", () => {
  const r = rng(1);
  assert.ok(equity(["As", "Ah"], [], 1, 2000, r) > 0.8);
  assert.ok(equity(["7c", "2d"], [], 1, 2000, r) < 0.4);
  assert.ok(equity(["As", "Ah"], [], 5, 1000, r) < equity(["As", "Ah"], [], 1, 1000, r)); // more opponents, less equity
  assert.equal(equity(["As", "Ks"], ["Qs", "Js", "Ts", "2d", "3c"], 3, 200, r), 1);
});

test("Elo sets skill and the default style; real hands take over after ~50", () => {
  assert.equal(skillFromElo(800), 0);
  assert.equal(skillFromElo(1600), 1);
  const beginner = defaultStyleForElo(1000);
  const expert = defaultStyleForElo(1600);
  assert.ok(beginner.vpip > expert.vpip && beginner.aggression < expert.aggression);
  const loose = { vpip: 0.8, pfr: 0.5, aggression: 4, hands: 25 };
  assert.ok(Math.abs(blendStyle(loose, 1200).vpip - (defaultStyleForElo(1200).vpip + 0.8) / 2) < 1e-9); // half weight at 25 hands
  assert.equal(blendStyle({ ...loose, hands: 200 }, 1200).vpip, 0.8);
  assert.deepEqual(blendStyle(null, 1200), defaultStyleForElo(1200));
});

test("stats tracker counts VPIP, PFR, aggression and showdowns", () => {
  const t = new StatsTracker();
  t.handStarted(["a", "b"]);
  t.action("a", { type: "raise", to: 60 }, "preflop");
  t.action("b", { type: "call" }, "preflop");
  t.action("b", { type: "check" }, "flop");
  t.action("a", { type: "raise", to: 100 }, "flop");
  t.action("b", { type: "fold" }, "flop");
  t.handEnded(true, []);
  t.handStarted(["a", "b"]);
  t.action("a", { type: "fold" }, "preflop");
  t.handEnded(false, []);
  const a = t.stats.get("a")!;
  const b = t.stats.get("b")!;
  assert.deepEqual([a.hands, a.vpip, a.pfr, a.aggressive, a.sawFlop], [2, 1, 1, 2, 1]);
  assert.deepEqual([b.hands, b.vpip, b.pfr, b.passive, b.sawFlop], [2, 1, 0, 1, 1]);
  const style = styleFromStats([a])!;
  assert.equal(style.vpip, 0.5);
  assert.equal(style.aggression, 2);
});

test("personas mirror the player's style in their own direction", () => {
  const you = defaultStyleForElo(1300);
  const [shark, maniac, rock] = ["shark", "maniac", "rock"].map(id => PERSONAS.find(p => p.id === id)!.shift(you));
  assert.ok(maniac!.vpip > you.vpip && maniac!.aggression > you.aggression);
  assert.ok(rock!.vpip < you.vpip && rock!.aggression < you.aggression);
  assert.ok(shark!.aggression > you.aggression);
  assert.deepEqual(aiSeats(5), ["ai:shark:1", "ai:maniac:1", "ai:rock:1", "ai:shark:2", "ai:maniac:2"]);
  assert.equal(aiName("ai:maniac:2"), "The Maniac 2");
  assert.equal(personaOf("ai:rock:1")!.model, "llama3.1-8b");
});

test("rule moves are sensible and always legal", () => {
  const style = defaultStyleForElo(1300);
  const legal = { toCall: 0, canCheck: true, canRaise: true, minRaiseTo: 20, maxRaiseTo: 1500 };
  const base = { street: "flop", pot: 100, stack: 1500, bigBlind: 20, toCall: 0, legal };
  assert.equal(ruleMove({ ...base, equity: 0.9 }, style, () => 0.99).type, "raise");
  assert.equal(ruleMove({ ...base, equity: 0.2 }, style, () => 0.99).type, "check");
  const facing = { ...base, toCall: 300, legal: { ...legal, toCall: 300, canCheck: false, minRaiseTo: 600 } };
  assert.equal(ruleMove({ ...facing, equity: 0.1 }, style, () => 0.99).type, "fold");
  assert.equal(ruleMove({ ...facing, equity: 0.95 }, style, () => 0.99).type, "raise");
  // Short-stacked: shove decent hands.
  const short = { ...facing, stack: 150, legal: { ...facing.legal, maxRaiseTo: 150, minRaiseTo: 150 } };
  assert.deepEqual(ruleMove({ ...short, equity: 0.6 }, style), { type: "raise", to: 150 });
  // Legalizing model output.
  assert.deepEqual(legalize({ type: "fold" }, legal), { type: "check" });
  assert.deepEqual(legalize({ type: "raise", to: 99_999 }, legal), { type: "raise", to: 1500 });
  assert.deepEqual(legalize({ type: "check" }, facing.legal), { type: "fold" });
});

test("parses model replies, tolerating extra words", () => {
  assert.deepEqual(parseMove('{"action":"raise","amount":120}'), { action: "raise", amount: 120 });
  assert.deepEqual(parseMove('Sure! {"action": "call", "amount": 0} good luck'), { action: "call", amount: 0 });
  assert.equal(parseMove('{"action":"shove"}'), null);
  assert.equal(parseMove("I fold"), null);
});

test("Cortex call: PAT headers, structured output, plain-JSON retry", async () => {
  const seen: any[] = [];
  const fake: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init!.body));
    seen.push({ url: String(url), headers: init!.headers, body });
    if (body.response_format) return new Response("structured output not supported", { status: 400 });
    return Response.json({ choices: [{ message: { content: '{"action":"check","amount":0}' } }], usage: { prompt_tokens: 300, completion_tokens: 12 } });
  };
  const auth = { account: "myorg-my_account", token: "pat-secret" };
  const { move, tokens } = await cortexMove(auth, "llama3.1-8b", "sys", "user", { fetchImpl: fake });
  assert.deepEqual(move, { action: "check", amount: 0 });
  assert.deepEqual(tokens, { in: 300, out: 12 });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, "https://myorg-my-account.snowflakecomputing.com/api/v2/cortex/v1/chat/completions");
  assert.equal(seen[0].headers.Authorization, "Bearer pat-secret");
  assert.equal(seen[0].headers["X-Snowflake-Authorization-Token-Type"], "PROGRAMMATIC_ACCESS_TOKEN");
  assert.equal(seen[0].body.max_completion_tokens, 60);
  // Next call to the same model skips straight to plain JSON.
  await cortexMove(auth, "llama3.1-8b", "sys", "user", { fetchImpl: fake });
  assert.equal(seen.length, 3);
  assert.equal(seen[2].body.response_format, undefined);
});

test("AI player: Cortex picks the move, bad replies fall back to rules", async () => {
  const game = new SitAndGo({ playerIds: ["human", "ai:shark:1"], seed: new Uint8Array(32), startedAt: 0 });
  game.startHand(0); // button = human (SB) acts first heads-up
  game.act("human", { type: "call" });
  const shark = new AiPlayer("ai:shark:1", personaOf("ai:shark:1")!, defaultStyleForElo(1200), 0.4, { account: "x-y", token: "t" }, rng(3));

  let prompt = "";
  const good: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    prompt = body.messages[1].content;
    assert.equal(body.model, "claude-haiku-4-5");
    return Response.json({ choices: [{ message: { content: '{"action":"raise","amount":5000}' } }] });
  };
  const d1 = await shark.decide(viewFromSitAndGo(game, "ai:shark:1"), { useCortex: true, fetchImpl: good });
  assert.equal(d1.source, "cortex");
  assert.deepEqual(d1.action, { type: "raise", to: 1500 }); // clamped to the stack
  assert.match(prompt, /Your cards: \S\S \S\S/);
  assert.match(prompt, /Legal: check, fold, raise to 40-1500/);

  const broken: typeof fetch = async () => new Response("down", { status: 503 });
  const d2 = await shark.decide(viewFromSitAndGo(game, "ai:shark:1"), { useCortex: true, fetchImpl: broken });
  assert.equal(d2.source, "rules");
  assert.match(d2.error!, /503/);

  const d3 = await shark.decide(viewFromSitAndGo(game, "ai:shark:1"), { useCortex: false });
  assert.equal(d3.source, "rules");
  assert.equal(d3.error, undefined);
});
