import { SitAndGo, type Action } from "./game.ts";
import type { Mode } from "./matchmaker.ts";

export const TIMING = {
  turnMs: 20_000,
  timeBankMs: 60_000,
  betweenHandsMs: 3_000,
  /** Extra pause after an uncontested win so the winner can choose to show. */
  showWindowMs: 5_000,
};

/** Short wallet label for the table log, e.g. "8Kx3…2Fa9". */
export const shortName = (id: string) => `${id.slice(0, 4)}…${id.slice(-4)}`;

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
  /** Ranked games count for Elo and settle on-chain; practice games don't. */
  ranked = true;
  /** When the current turn's base timer started. */
  turnStartedAt = 0;
  /** PokerNow-style running log of the game. */
  readonly log: string[] = [];
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
    this.startHand();
  }

  act(player: string, action: Action, note = "") {
    if (this.game.view().toAct !== player) throw new Error("not your turn");
    const overrun = Date.now() - this.turnStartedAt - TIMING.turnMs;
    const { toCall } = this.game.legal(player);
    const handBefore = this.game.handNo;
    this.game.act(player, action);
    if (overrun > 0) this.timeBank.set(player, Math.max(0, this.timeBank.get(player)! - overrun));
    const verb =
      action.type === "fold" ? "folds" : action.type === "check" ? "checks" : action.type === "call" ? `calls ${toCall}` : `raises to ${action.to}`;
    this.note(`${shortName(player)} ${verb}${this.game.seats[this.game.seatOf(player)]!.allIn ? " (all in)" : ""}${note}`);
    if (this.game.street === "done" && this.game.handNo === handBefore) this.noteResults();
    this.afterChange();
  }

  show(player: string) {
    this.game.show(player);
    this.note(`${shortName(player)} shows ${this.game.seats[this.game.seatOf(player)]!.cards.join(" ")}`);
    this.events.update();
  }

  private note(line: string) {
    this.log.push(line);
    if (this.log.length > 200) this.log.shift();
  }

  private startHand() {
    this.game.startHand(Date.now());
    const [sb, bb] = this.game.view().blinds;
    this.note(`— Hand #${this.game.handNo} · blinds ${sb}/${bb} · ${shortName(this.game.seats[this.game.button]!.id)} has the button`);
    // Blinds alone can put everyone all in; the hand then runs out with no actions.
    if (this.game.street === "done") this.noteResults();
    this.afterChange();
  }

  private noteResults() {
    if (this.game.board.length) this.note(`Board: ${this.game.board.join(" ")}`);
    for (const s of this.game.seats) if (s.shown && !s.folded && !s.out) this.note(`${shortName(s.id)} shows ${s.cards.join(" ")}`);
    for (const pot of this.game.lastResult) {
      this.note(`${pot.winners.map(shortName).join(" & ")} ${pot.winners.length > 1 ? "split" : "wins"} ${pot.amount}${pot.hand ? ` with ${pot.hand}` : ""}`);
    }
    for (const [id, place] of this.game.places) {
      if (!this.log.some(l => l.startsWith(`${shortName(id)} finishes`))) this.note(`${shortName(id)} finishes #${place}`);
    }
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
    this.act(player, legal.canCheck ? { type: "check" } : { type: "fold" }, this.connected.has(player) ? " (timed out)" : " (away)");
  }

  private afterChange() {
    clearTimeout(this.timer);
    if (this.closed) return;
    this.events.update();

    if (this.game.street === "done") {
      if (this.game.finished) return this.events.finished(this.game.places);
      const pause = TIMING.betweenHandsMs + (this.game.canShow !== null ? TIMING.showWindowMs : 0);
      this.timer = setTimeout(() => this.startHand(), pause);
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
