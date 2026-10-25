import type { Action, Street } from "../game.ts";

/**
 * How someone plays, from their hands:
 *   vpip        share of hands they voluntarily put chips in preflop (loose vs tight)
 *   pfr         share of hands they raised preflop
 *   aggression  bets+raises per call (passive < 1 < aggressive)
 */
export type Style = { vpip: number; pfr: number; aggression: number; hands: number };

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** 0 (beginner) .. 1 (expert) from Elo: 900 and below is 0, 1600 and above is 1. */
export const skillFromElo = (elo: number) => clamp((elo - 900) / 700, 0, 1);

/** Typical style at a rating: newer players are looser and more passive. */
export function defaultStyleForElo(elo: number): Style {
  const s = skillFromElo(elo);
  return { vpip: 0.45 - 0.2 * s, pfr: 0.08 + 0.12 * s, aggression: 0.8 + 1.8 * s, hands: 0 };
}

/** Elo default until ~50 hands, then the player's real tendencies take over. */
export function blendStyle(observed: Style | null, elo: number, fullAt = 50): Style {
  const base = defaultStyleForElo(elo);
  if (!observed || observed.hands === 0) return base;
  const w = clamp(observed.hands / fullAt, 0, 1);
  const mix = (a: number, b: number) => a * (1 - w) + b * w;
  return {
    vpip: mix(base.vpip, observed.vpip),
    pfr: mix(base.pfr, observed.pfr),
    aggression: mix(base.aggression, observed.aggression),
    hands: observed.hands,
  };
}

/** Per-game counters for one player; one row of these goes to Snowflake when the game ends. */
export type GameStats = {
  hands: number;
  vpip: number;
  pfr: number;
  aggressive: number;
  passive: number;
  sawFlop: number;
  showdowns: number;
  showdownsWon: number;
};

const emptyStats = (): GameStats => ({ hands: 0, vpip: 0, pfr: 0, aggressive: 0, passive: 0, sawFlop: 0, showdowns: 0, showdownsWon: 0 });

/** Turns table actions into style counters. Feed it from the table runner's events. */
export class StatsTracker {
  readonly stats = new Map<string, GameStats>();
  private hand = { inPreflop: new Set<string>(), vpip: new Set<string>(), pfr: new Set<string>(), foldedPreflop: new Set<string>() };

  handStarted(players: string[]) {
    this.hand = { inPreflop: new Set(players), vpip: new Set(), pfr: new Set(), foldedPreflop: new Set() };
    for (const p of players) this.of(p).hands++;
  }

  action(player: string, action: Action, street: Street) {
    const s = this.of(player);
    if (action.type === "raise") s.aggressive++;
    if (action.type === "call") s.passive++;
    if (street !== "preflop") return;
    if (action.type === "call" || action.type === "raise") this.hand.vpip.add(player);
    if (action.type === "raise") this.hand.pfr.add(player);
    if (action.type === "fold") this.hand.foldedPreflop.add(player);
  }

  handEnded(sawFlop: boolean, showdown: { player: string; won: boolean }[]) {
    for (const p of this.hand.vpip) this.of(p).vpip++;
    for (const p of this.hand.pfr) this.of(p).pfr++;
    if (sawFlop) for (const p of this.hand.inPreflop) if (!this.hand.foldedPreflop.has(p)) this.of(p).sawFlop++;
    for (const { player, won } of showdown) {
      this.of(player).showdowns++;
      if (won) this.of(player).showdownsWon++;
    }
  }

  private of(player: string) {
    if (!this.stats.has(player)) this.stats.set(player, emptyStats());
    return this.stats.get(player)!;
  }
}

/** Rolls game rows up into a style (what the Snowflake PLAYER_STYLE view computes). */
export function styleFromStats(rows: GameStats[]): Style | null {
  const t = rows.reduce((a, r) => {
    for (const k of Object.keys(a) as (keyof GameStats)[]) a[k] += r[k];
    return a;
  }, emptyStats());
  if (t.hands === 0) return null;
  return { vpip: t.vpip / t.hands, pfr: t.pfr / t.hands, aggression: t.aggressive / Math.max(1, t.passive), hands: t.hands };
}
