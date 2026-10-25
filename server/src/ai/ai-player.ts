import type { Action, SitAndGo } from "../game.ts";
import { type SnowflakeAuth, cortexMove } from "./cortex.ts";
import type { Persona } from "./personas.ts";
import { type Situation, legalize, potOdds, ruleMove } from "./policy.ts";
import { equity } from "./strength.ts";
import { type Style, clamp } from "./style.ts";

export type AiDecision = { action: Action; source: "cortex" | "rules"; error?: string; tokens?: { in: number; out: number } };

/**
 * One AI opponent. The engine does the poker math (equity, pot odds, legal moves) and blurs
 * its own read by skill; the persona's Cortex model then chooses the move. Anything slow,
 * failed or illegal falls back to the rule-based move for the same style.
 */
export class AiPlayer {
  readonly id: string;
  readonly persona: Persona;
  readonly style: Style;
  /** 0 beginner .. 1 expert, from the human player's Elo. */
  readonly skill: number;
  private readonly auth: SnowflakeAuth | null;
  private readonly random: () => number;

  constructor(id: string, persona: Persona, mirrored: Style, skill: number, auth: SnowflakeAuth | null, random = Math.random) {
    this.id = id;
    this.persona = persona;
    this.style = persona.shift(mirrored);
    this.skill = skill;
    this.auth = auth;
    this.random = random;
  }

  situation(game: SitAndGo): Situation {
    const view = game.view(this.id);
    const me = game.seats[game.seatOf(this.id)]!;
    const opponents = game.seats.filter(s => s.id !== this.id && !s.folded && !s.out).length;
    const trueEquity = equity(me.cards, game.board, opponents, 300, this.random);
    // Lower skill = fuzzier read of its own hand (up to ±~20% at skill 0).
    const blur = (this.random() + this.random() + this.random() - 1.5) * 0.25 * (1 - this.skill);
    return {
      street: game.street,
      equity: clamp(trueEquity + blur, 0, 1),
      toCall: view.legal!.toCall,
      pot: game.pot,
      stack: me.stack,
      bigBlind: game.bigBlind,
      legal: view.legal!,
    };
  }

  prompt(game: SitAndGo, s: Situation, suggestion: Action) {
    const me = game.seats[game.seatOf(this.id)]!;
    const level = this.skill < 0.33 ? "a beginner" : this.skill < 0.66 ? "an intermediate player" : "a strong player";
    const system =
      `You are ${this.persona.name}, ${this.persona.voice}, playing no-limit hold'em Sit & Go at the level of ${level}. ` +
      `Your style: you play about ${Math.round(this.style.vpip * 100)}% of hands, raise preflop about ${Math.round(this.style.pfr * 100)}%, ` +
      `aggression factor ${this.style.aggression.toFixed(1)}. Stay in character. ` +
      `Reply with JSON only: {"action":"fold"|"check"|"call"|"raise","amount":<total to raise to, or 0>}.`;
    const others = game.seats
      .filter(x => x.id !== this.id && !x.out)
      .map(x => `${x.stack}${x.folded ? " (folded)" : x.allIn ? " (all in)" : ""}`)
      .join(", ");
    const legalText = [
      s.legal.canCheck ? "check" : `call ${s.toCall}`,
      "fold",
      s.legal.canRaise ? `raise to ${s.legal.minRaiseTo}-${s.legal.maxRaiseTo}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const user =
      `Street: ${s.street}. Your cards: ${me.cards.join(" ")}. Board: ${game.board.join(" ") || "none"}. ` +
      `Pot ${s.pot}, to call ${s.toCall}, your stack ${s.stack} (${Math.round(s.stack / s.bigBlind)} big blinds), blinds ${game.smallBlind}/${game.bigBlind}. ` +
      `Opponent stacks: ${others}. Your estimated chance to win: ${Math.round(s.equity * 100)}%` +
      (s.toCall ? `; pot odds need ${Math.round(potOdds(s) * 100)}%` : "") +
      `. Legal: ${legalText}. A coach suggests: ${suggestion.type === "raise" ? `raise to ${suggestion.to}` : suggestion.type}. Your move?`;
    return { system, user };
  }

  async decide(game: SitAndGo, options: { useCortex: boolean; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<AiDecision> {
    const s = this.situation(game);
    const fallback = legalize(ruleMove(s, this.style, this.random), s.legal);
    if (!options.useCortex || !this.auth) return { action: fallback, source: "rules" };
    try {
      const { system, user } = this.prompt(game, s, fallback);
      const { move, tokens } = await cortexMove(this.auth, this.persona.model, system, user, {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      });
      const proposed: Action = move.action === "raise" ? { type: "raise", to: move.amount ?? s.legal.minRaiseTo } : { type: move.action };
      return { action: legalize(proposed, s.legal), source: "cortex", tokens };
    } catch (e) {
      return { action: fallback, source: "rules", error: (e as Error).message };
    }
  }
}
