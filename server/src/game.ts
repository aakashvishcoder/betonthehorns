import { type Card, shuffledDeck } from "./cards.ts";
import { evaluate } from "./evaluate.ts";

export type Action = { type: "fold" } | { type: "check" } | { type: "call" } | { type: "raise"; to: number };
export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "done";

export type Seat = {
  id: string;
  stack: number;
  /** Chips put in on the current street. */
  bet: number;
  /** Chips put in this hand. */
  committed: number;
  folded: boolean;
  allIn: boolean;
  /** Busted out of the Sit & Go. */
  out: boolean;
  cards: Card[];
  /** Cards visible to everyone (called showdown, or a winner choosing to show). */
  shown: boolean;
};

export type PotResult = { amount: number; winners: string[]; hand?: string };

export type Legal = {
  toCall: number;
  canCheck: boolean;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
};

export type SitAndGoOptions = {
  playerIds: string[];
  seed: Uint8Array;
  startedAt: number;
  startingStack?: number;
  blindLevelMs?: number;
  /** Tests only: fixed decks instead of the seeded shuffle. */
  deckFor?: (hand: number) => Card[];
};

const STREETS: Street[] = ["preflop", "flop", "turn", "river"];

/** One ranked Sit & Go: everyone starts equal, blinds double on a timer, last player standing wins. */
export class SitAndGo {
  readonly seats: Seat[];
  readonly seed: Uint8Array;
  readonly startedAt: number;
  readonly blindLevelMs: number;
  private readonly deckFor: (hand: number) => Card[];

  handNo = 0;
  button = -1;
  street: Street = "done";
  board: Card[] = [];
  smallBlind = 0;
  bigBlind = 0;
  currentBet = 0;
  /** Size of the last full raise; the next raise must be at least this much more. */
  minRaise = 0;
  toAct: number | null = null;
  lastResult: PotResult[] = [];
  /** Seat that won uncontested and may choose to show. */
  canShow: number | null = null;
  /** Finish place per player id (1 = winner). */
  readonly places = new Map<string, number>();

  private deck: Card[] = [];
  private pending = new Set<number>();
  /** Players who may only call or fold after a short all-in raise. */
  private raiseLocked = new Set<number>();
  private stacksAtStart: number[] = [];

  constructor(options: SitAndGoOptions) {
    const stack = options.startingStack ?? 1500;
    this.seats = options.playerIds.map(id => ({
      id,
      stack,
      bet: 0,
      committed: 0,
      folded: false,
      allIn: false,
      out: false,
      cards: [],
      shown: false,
    }));
    this.seed = options.seed;
    this.startedAt = options.startedAt;
    this.blindLevelMs = options.blindLevelMs ?? 5 * 60_000;
    this.deckFor = options.deckFor ?? (hand => shuffledDeck(this.seed, hand));
  }

  get finished() {
    return this.places.size === this.seats.length;
  }

  get pot() {
    return this.seats.reduce((sum, s) => sum + s.committed, 0);
  }

  seatOf(id: string) {
    const i = this.seats.findIndex(s => s.id === id);
    if (i < 0) throw new Error(`unknown player ${id}`);
    return i;
  }

  private live = (i: number) => !this.seats[i]!.out;
  private inHand = (i: number) => this.live(i) && !this.seats[i]!.folded;
  private able = (i: number) => this.inHand(i) && !this.seats[i]!.allIn;

  /** First seat after `from` (clockwise) matching `pred`. */
  private next(from: number, pred: (i: number) => boolean): number {
    for (let step = 1; step <= this.seats.length; step++) {
      const i = (from + step) % this.seats.length;
      if (pred(i)) return i;
    }
    return -1;
  }

  startHand(now: number) {
    if (this.finished) throw new Error("game is over");
    if (this.street !== "done") throw new Error("hand in progress");
    this.handNo++;
    const level = Math.max(0, Math.floor((now - this.startedAt) / this.blindLevelMs));
    this.bigBlind = 20 * 2 ** level;
    this.smallBlind = this.bigBlind / 2;

    for (const s of this.seats) {
      Object.assign(s, { bet: 0, committed: 0, folded: s.out, allIn: false, cards: [], shown: false });
    }
    this.stacksAtStart = this.seats.map(s => s.stack);
    this.board = [];
    this.lastResult = [];
    this.canShow = null;
    this.raiseLocked.clear();

    const liveCount = this.seats.filter(s => !s.out).length;
    this.button =
      this.button < 0 ? this.next(this.seed[0]! % this.seats.length - 1 + this.seats.length, this.live) : this.next(this.button, this.live);

    this.deck = [...this.deckFor(this.handNo)];
    for (let round = 0; round < 2; round++) {
      for (let i = this.next(this.button, this.live), dealt = 0; dealt < liveCount; i = this.next(i, this.live), dealt++) {
        this.seats[i]!.cards.push(this.deck.shift()!);
      }
    }

    // Heads-up: the button posts the small blind and acts first preflop.
    const sb = liveCount === 2 ? this.button : this.next(this.button, this.live);
    const bb = this.next(sb, this.live);
    this.put(sb, Math.min(this.smallBlind, this.seats[sb]!.stack));
    this.put(bb, Math.min(this.bigBlind, this.seats[bb]!.stack));
    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;
    this.street = "preflop";
    this.openRound(bb);
  }

  private put(i: number, amount: number) {
    const s = this.seats[i]!;
    s.stack -= amount;
    s.bet += amount;
    s.committed += amount;
    if (s.stack === 0) s.allIn = true;
  }

  /** Everyone able must act; action starts left of `after`. */
  private openRound(after: number) {
    this.pending = new Set(this.seats.map((_, i) => i).filter(this.able));
    // Nobody left who can bet against anyone else: just deal the rest.
    const facingBet = [...this.pending].some(i => this.seats[i]!.bet < this.currentBet);
    if (this.pending.size === 0 || (this.pending.size === 1 && !facingBet)) return this.nextStreet();
    this.toAct = this.next(after, i => this.pending.has(i));
  }

  legal(id: string): Legal {
    const i = this.seatOf(id);
    const s = this.seats[i]!;
    const toCall = Math.min(this.currentBet - s.bet, s.stack);
    const maxRaiseTo = s.bet + s.stack;
    const othersCanAct = this.seats.some((_, j) => j !== i && this.able(j));
    return {
      toCall,
      canCheck: toCall === 0,
      canRaise: maxRaiseTo > this.currentBet && othersCanAct && !this.raiseLocked.has(i),
      minRaiseTo: Math.min(this.currentBet + this.minRaise, maxRaiseTo),
      maxRaiseTo,
    };
  }

  act(id: string, action: Action) {
    const i = this.seatOf(id);
    if (this.toAct !== i) throw new Error("not your turn");
    const s = this.seats[i]!;
    const legal = this.legal(id);

    switch (action.type) {
      case "fold":
        s.folded = true;
        break;
      case "check":
        if (!legal.canCheck) throw new Error("cannot check facing a bet");
        break;
      case "call":
        if (legal.toCall === 0) throw new Error("nothing to call");
        this.put(i, legal.toCall);
        break;
      case "raise": {
        const to = action.to;
        if (!legal.canRaise) throw new Error("raising is not allowed");
        if (!Number.isInteger(to) || to < legal.minRaiseTo || to > legal.maxRaiseTo) {
          throw new Error(`raise must be to between ${legal.minRaiseTo} and ${legal.maxRaiseTo}`);
        }
        const increment = to - this.currentBet;
        const actedAlready = this.seats.map((_, j) => j).filter(j => this.able(j) && j !== i && !this.pending.has(j));
        this.put(i, to - s.bet);
        if (increment >= this.minRaise) {
          // Full raise: everyone gets to act again, with raising allowed.
          this.minRaise = increment;
          this.raiseLocked.clear();
          this.pending = new Set(this.seats.map((_, j) => j).filter(j => j !== i && this.able(j)));
        } else {
          // Short all-in: players who already acted may only call or fold.
          for (const j of actedAlready) {
            this.pending.add(j);
            this.raiseLocked.add(j);
          }
        }
        this.currentBet = to;
        break;
      }
    }
    this.pending.delete(i);

    const remaining = this.seats.map((_, j) => j).filter(this.inHand);
    if (remaining.length === 1) return this.winUncontested(remaining[0]!);
    if (this.pending.size === 0) return this.nextStreet();
    this.toAct = this.next(i, j => this.pending.has(j));
  }

  private nextStreet() {
    for (const s of this.seats) s.bet = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.raiseLocked.clear();
    this.toAct = null;

    const index = STREETS.indexOf(this.street);
    if (this.street === "river") return this.showdown();
    this.street = STREETS[index + 1]!;
    this.deck.shift(); // burn
    this.board.push(...this.deck.splice(0, this.street === "flop" ? 3 : 1));
    this.openRound(this.button);
  }

  private winUncontested(winner: number) {
    this.seats[winner]!.stack += this.pot;
    this.lastResult = [{ amount: this.pot, winners: [this.seats[winner]!.id] }];
    this.canShow = winner;
    this.finishHand();
  }

  /**
   * Main pot and side pots from what each player committed. Chips nobody still
   * in the hand matched (e.g. a folded small blind over all-ins) are refunded.
   */
  private pots() {
    const levels = [...new Set(this.seats.map(s => s.committed).filter(c => c > 0))].sort((a, b) => a - b);
    const pots: { amount: number; eligible: number[] }[] = [];
    let previous = 0;
    for (const level of levels) {
      const amount = this.seats.reduce((sum, s) => sum + Math.min(s.committed, level) - Math.min(s.committed, previous), 0);
      const eligible = this.seats.map((_, i) => i).filter(i => this.inHand(i) && this.seats[i]!.committed >= level);
      if (eligible.length === 0) {
        // Every contributor at this level put in the same amount.
        const contributors = this.seats.filter(s => s.committed >= level);
        for (const s of contributors) s.stack += amount / contributors.length;
        previous = level;
        continue;
      }
      const last = pots.at(-1);
      if (last && last.eligible.join() === eligible.join()) last.amount += amount;
      else pots.push({ amount, eligible });
      previous = level;
    }
    return pots;
  }

  private showdown() {
    this.street = "showdown";
    const contenders = this.seats.map((_, i) => i).filter(this.inHand);
    for (const i of contenders) this.seats[i]!.shown = true;
    const values = new Map(contenders.map(i => [i, evaluate([...this.seats[i]!.cards, ...this.board])]));

    for (const pot of this.pots()) {
      const best = Math.max(...pot.eligible.map(i => values.get(i)!.score));
      // Odd chips go to the winner closest to the button's left.
      const winners = pot.eligible
        .filter(i => values.get(i)!.score === best)
        .sort((a, b) => ((a - this.button - 1 + this.seats.length) % this.seats.length) - ((b - this.button - 1 + this.seats.length) % this.seats.length));
      const share = Math.floor(pot.amount / winners.length);
      winners.forEach((w, k) => (this.seats[w]!.stack += share + (k < pot.amount % winners.length ? 1 : 0)));
      this.lastResult.push({
        amount: pot.amount,
        winners: winners.map(w => this.seats[w]!.id),
        hand: pot.eligible.length > 1 ? values.get(winners[0]!)!.name : undefined,
      });
    }
    this.finishHand();
  }

  private finishHand() {
    this.street = "done";
    this.toAct = null;
    this.pending.clear();

    const busted = this.seats.map((_, i) => i).filter(i => this.live(i) && this.seats[i]!.stack === 0);
    const survivors = this.seats.filter(s => !s.out).length - busted.length;
    // Same-hand busts: bigger starting stack finishes higher; equal stacks tie.
    busted.sort((a, b) => this.stacksAtStart[b]! - this.stacksAtStart[a]!);
    busted.forEach((i, k) => {
      const tiedWithPrevious = k > 0 && this.stacksAtStart[i] === this.stacksAtStart[busted[k - 1]!];
      const place = tiedWithPrevious ? this.places.get(this.seats[busted[k - 1]!]!.id)! : survivors + k + 1;
      this.places.set(this.seats[i]!.id, place);
      this.seats[i]!.out = true;
    });
    if (survivors === 1) this.places.set(this.seats.find(s => !s.out)!.id, 1);
  }

  /** Ends the game between hands: everyone still in is placed by chip count (equal stacks tie). */
  finishNow() {
    if (this.street !== "done") throw new Error("hand in progress");
    const live = this.seats.filter(s => !s.out).sort((a, b) => b.stack - a.stack);
    live.forEach((s, k) => {
      const prev = live[k - 1];
      this.places.set(s.id, prev && prev.stack === s.stack ? this.places.get(prev.id)! : k + 1);
    });
  }

  /** Winner of an uncontested pot shows their cards (otherwise they stay mucked). */
  show(id: string) {
    const i = this.seatOf(id);
    if (this.canShow !== i) throw new Error("nothing to show");
    this.seats[i]!.shown = true;
    this.canShow = null;
  }

  /** What `viewer` may see: own hole cards, everyone's shown cards, nothing else. */
  view(viewer?: string) {
    return {
      handNo: this.handNo,
      street: this.street,
      board: this.board,
      pot: this.pot,
      button: this.button,
      blinds: [this.smallBlind, this.bigBlind],
      currentBet: this.currentBet,
      toAct: this.toAct === null ? null : this.seats[this.toAct]!.id,
      seats: this.seats.map(s => ({
        id: s.id,
        stack: s.stack,
        bet: s.bet,
        folded: s.folded,
        allIn: s.allIn,
        out: s.out,
        cards: s.shown || s.id === viewer ? s.cards : s.cards.map(() => null),
      })),
      lastResult: this.lastResult,
      places: Object.fromEntries(this.places),
      legal: viewer && this.toAct !== null && this.seats[this.toAct]!.id === viewer ? this.legal(viewer) : null,
      canShow: viewer !== undefined && this.canShow !== null && this.seats[this.canShow]!.id === viewer,
    };
  }
}
