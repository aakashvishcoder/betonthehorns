import { SitAndGo, type Action } from "./game.ts";
import type { Mode } from "./matchmaker.ts";

export const TIMING = {
  turnMs: 20_000,
  timeBankMs: 60_000,
  betweenHandsMs: 3_000,
  /** Extra pause after an uncontested win so the winner can choose to show. */
  showWindowMs: 5_000,
};

export type TableEvents = {
  /** Something changed; push fresh views to players and spectators. */
  update(): void;
  finished(places: Map<string, number>): void;
};

/**
 * Runs one Sit & Go in real time: turn timer with a per-game time bank,
 * auto check/fold on timeout or while disconnected (blinded out), pauses between hands.
 */
export class TableRunner {
  readonly id: string;
  readonly mode: Mode;
  readonly players: string[];
  readonly game: SitAndGo;
  readonly connected: Set<string>;
  readonly timeBank: Map<string, number>;
  /** When the current turn's base timer started. */
  turnStartedAt = 0;
  private readonly events: TableEvents;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(id: string, mode: Mode, players: string[], seed: Uint8Array, events: TableEvents) {
    this.id = id;
    this.mode = mode;
    this.players = players;
    this.events = events;
    this.game = new SitAndGo({ playerIds: players, seed, startedAt: Date.now() });
    this.connected = new Set(players);
    this.timeBank = new Map(players.map(p => [p, TIMING.timeBankMs]));
  }

  start() {
    this.game.startHand(Date.now());
    this.afterChange();
  }

  act(player: string, action: Action) {
    if (this.game.view().toAct !== player) throw new Error("not your turn");
    const overrun = Date.now() - this.turnStartedAt - TIMING.turnMs;
    this.game.act(player, action);
    if (overrun > 0) this.timeBank.set(player, Math.max(0, this.timeBank.get(player)! - overrun));
    this.afterChange();
  }

  show(player: string) {
    this.game.show(player);
    this.events.update();
  }

  disconnect(player: string) {
    this.connected.delete(player);
    // If they were thinking, act for them now rather than burning the clock.
    if (this.game.view().toAct === player) this.autoAct(player);
  }

  reconnect(player: string) {
    this.connected.add(player);
    this.events.update();
  }

  /** Seconds left for whoever is acting: base timer, then time bank. */
  clock() {
    const toAct = this.game.view().toAct;
    if (!toAct) return null;
    const elapsed = Date.now() - this.turnStartedAt;
    return {
      player: toAct,
      turnMsLeft: Math.max(0, TIMING.turnMs - elapsed),
      bankMsLeft: Math.max(0, this.timeBank.get(toAct)! - Math.max(0, elapsed - TIMING.turnMs)),
    };
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
  }

  private autoAct(player: string) {
    const legal = this.game.legal(player);
    this.act(player, legal.canCheck ? { type: "check" } : { type: "fold" });
  }

  private afterChange() {
    clearTimeout(this.timer);
    if (this.closed) return;
    this.events.update();

    if (this.game.street === "done") {
      if (this.game.finished) return this.events.finished(this.game.places);
      const pause = TIMING.betweenHandsMs + (this.game.canShow !== null ? TIMING.showWindowMs : 0);
      this.timer = setTimeout(() => {
        this.game.startHand(Date.now());
        this.afterChange();
      }, pause);
      return;
    }

    const player = this.game.view().toAct!;
    this.turnStartedAt = Date.now();
    if (!this.connected.has(player)) {
      this.timer = setTimeout(() => this.autoAct(player), 0);
      return;
    }
    this.timer = setTimeout(() => this.autoAct(player), TIMING.turnMs + this.timeBank.get(player)!);
  }
}
