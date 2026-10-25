import type { Action, Legal } from "../game.ts";
import { type Style, clamp } from "./style.ts";

/** Everything a decision needs, already computed by the engine. */
export type Situation = {
  street: string;
  equity: number; // 0..1, already skill-blurred
  toCall: number;
  pot: number;
  stack: number;
  bigBlind: number;
  legal: Legal;
};

export const potOdds = (s: Situation) => (s.toCall === 0 ? 0 : s.toCall / (s.pot + s.toCall));

/** A sensible raise target: ~3 big blinds preflop, ~2/3 pot after. */
export function raiseSize(s: Situation, factor = 1): number {
  const target = s.street === "preflop" ? s.legal.minRaiseTo + 2 * s.bigBlind * factor : s.legal.minRaiseTo + (2 / 3) * s.pot * factor;
  return Math.round(clamp(target, s.legal.minRaiseTo, s.legal.maxRaiseTo));
}

/**
 * Rule-based move for a style: the fallback when the AI model is slow or wrong,
 * and the "suggested" move the model sees. `random` drives bluffs.
 */
export function ruleMove(s: Situation, style: Style, random = Math.random): Action {
  const { legal } = s;
  const aggression = clamp(style.aggression / 3, 0, 1); // ~0 passive .. 1 very aggressive
  const looseness = clamp((style.vpip - 0.15) / 0.45, 0, 1); // ~0 tight .. 1 very loose
  const shortStacked = s.stack <= 10 * s.bigBlind;

  // Push-or-fold when short: go all in with a decent hand, otherwise give up.
  if (shortStacked && legal.canRaise && s.equity > 0.5 - 0.12 * looseness) return { type: "raise", to: legal.maxRaiseTo };

  if (legal.canCheck) {
    const valueBet = s.equity > 0.62 - 0.1 * aggression;
    const bluff = random() < 0.12 * aggression;
    if (legal.canRaise && (valueBet || bluff)) return { type: "raise", to: raiseSize(s) };
    return { type: "check" };
  }

  // Facing a bet: raise strong hands, call when the price is right (looser players call wider).
  if (legal.canRaise && s.equity > 0.72 - 0.1 * aggression) return { type: "raise", to: raiseSize(s, 1.5) };
  const margin = 0.08 - 0.1 * looseness;
  if (s.equity >= potOdds(s) + margin) return { type: "call" };
  return { type: "fold" };
}

/** Makes any proposed move legal: free folds become checks, raises are clamped. */
export function legalize(action: Action, legal: Legal): Action {
  if (action.type === "fold" && legal.canCheck) return { type: "check" };
  if (action.type === "check" && !legal.canCheck) return { type: "fold" };
  if (action.type === "call" && legal.canCheck) return { type: "check" };
  if (action.type === "raise") {
    if (!legal.canRaise) return legal.canCheck ? { type: "check" } : { type: "call" };
    return { type: "raise", to: Math.round(clamp(action.to, legal.minRaiseTo, legal.maxRaiseTo)) };
  }
  return action;
}
