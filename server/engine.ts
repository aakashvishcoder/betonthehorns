import { randomUUID } from "node:crypto";
import { seatLabel } from "./names.js";
import { cardCode, compareHands, evaluate, makeDeck } from "./poker.js";
import { newCommit, seededShuffle } from "./rng.js";
import {
  MODE_SEATS,
  type ActionInput,
  type GameMode,
  type LegalActions,
  type MatchState,
  type Player,
} from "./types.js";

export const STARTING_STACK = 1000;
export const STARTING_SB = 10;
export const STARTING_BB = 20;
export const BLIND_EVERY_HANDS = 8;
export const ACTION_MS = 25_000;
export const SHOWDOWN_MS = 4_500;
export const RUNOUT_MS = 780;

function nextIndex(
  match: MatchState,
  from: number,
  pred: (player: Player) => boolean,
) {
  const n = match.players.length;
  for (let step = 1; step <= n; step += 1) {
    const index = (from + step) % n;
    const player = match.players[index]!;
    if (pred(player)) return index;
  }
  return null;
}

function living(match: MatchState) {
  return match.players.filter((player) => !player.busted);
}

function inHand(match: MatchState) {
  return match.players.filter((player) => !player.busted && !player.folded);
}

function canAct(player: Player) {
  return !player.busted && !player.folded && !player.allIn && player.stack > 0;
}

function log(match: MatchState, line: string) {
  match.log.push(line);
  if (match.log.length > 80) match.log.splice(0, match.log.length - 80);
}

function postBlind(match: MatchState, index: number, want: number) {
  const player = match.players[index]!;
  const amount = Math.min(player.stack, want);
  player.stack -= amount;
  player.bet += amount;
  player.invested += amount;
  match.pot += amount;
  if (player.stack === 0) player.allIn = true;
  player.lastAction = `Blind ${amount}`;
}

function increaseBlinds(match: MatchState) {
  const nextBb = Math.max(2, Math.round((match.blinds.bb * 1.5) / 2) * 2);
  match.blinds = { sb: Math.max(1, nextBb / 2), bb: nextBb };
}

export function startHand(match: MatchState) {
  const alive = living(match);
  if (alive.length < 2) {
    finishMatch(match);
    return;
  }

  match.handNumber += 1;
  if (match.handNumber > 1 && (match.handNumber - 1) % BLIND_EVERY_HANDS === 0) {
    increaseBlinds(match);
    log(match, `Blinds ${match.blinds.sb}/${match.blinds.bb}`);
  }
  if (match.handNumber > 1) {
    match.dealerIndex =
      nextIndex(match, match.dealerIndex, (player) => !player.busted) ??
      match.dealerIndex;
  }

  for (const player of match.players) {
    player.hole = null;
    player.bet = 0;
    player.invested = 0;
    player.folded = player.busted;
    player.allIn = false;
    player.lastAction = player.busted ? "Out" : null;
    player.actedThisStreet = false;
  }

  const deck = freshDeck(match);
  for (const player of alive) {
    player.hole = [deck.pop()!, deck.pop()!];
  }

  match.street = "preflop";
  match.board = [];
  match.pot = 0;
  match.currentBet = match.blinds.bb;
  match.minRaise = match.blinds.bb;
  match.winners = [];
  match.showdownAt = null;
  match.runoutQueue = [];
  match.runoutAt = null;
  match.exposed = false;
  match.lastAggressor = null;

  const headsUp = alive.length === 2;
  const sbIndex = headsUp
    ? match.dealerIndex
    : (nextIndex(match, match.dealerIndex, (player) => !player.busted) ??
      match.dealerIndex);
  const bbIndex =
    nextIndex(match, sbIndex, (player) => !player.busted) ?? sbIndex;

  postBlind(match, sbIndex, match.blinds.sb);
  postBlind(match, bbIndex, match.blinds.bb);
  match.lastAggressor = bbIndex;

  const first = headsUp
    ? match.dealerIndex
    : (nextIndex(match, bbIndex, canAct) ??
      nextIndex(match, bbIndex, (player) => !player.busted && !player.folded));
  match.actionIndex = first !== null && canAct(match.players[first]!) ? first : null;
  match.actionDeadline = match.actionIndex === null ? null : Date.now() + ACTION_MS;
  log(match, `Hand ${match.handNumber}`);

  if (match.actionIndex === null) beginRunout(match);
}

export function createMatch(
  mode: GameMode,
  walletIds: string[],
  botIds: string[] = [],
): MatchState {
  const seats = MODE_SEATS[mode];
  const all = [...walletIds, ...botIds];
  if (all.length !== seats) {
    throw new Error(`Need ${seats} players for ${mode}`);
  }
  const match: MatchState = {
    id: randomUUID(),
    mode,
    status: "playing",
    players: all.map((walletId, seat) => ({
      walletId,
      seat,
      stack: STARTING_STACK,
      hole: null,
      bet: 0,
      invested: 0,
      folded: false,
      allIn: false,
      busted: false,
      bot: botIds.includes(walletId),
      lastAction: null,
      actedThisStreet: false,
      rank: "Bronze",
    })),
    dealerIndex: 0,
    street: "preflop",
    board: [],
    pot: 0,
    currentBet: 0,
    minRaise: STARTING_BB,
    actionIndex: null,
    lastAggressor: null,
    handNumber: 0,
    blinds: { sb: STARTING_SB, bb: STARTING_BB },
    winners: [],
    startedAt: Date.now(),
    showdownAt: null,
    actionDeadline: null,
    runoutQueue: [],
    runoutAt: null,
    exposed: false,
    log: [],
    chain: [],
    ...(() => {
      const commit = newCommit();
      return { commitHash: commit.commitHash, seed: commit.seed, rngCounter: 0 };
    })(),
  };
  startHand(match);
  return match;
}

export function legalActions(
  match: MatchState,
  walletId: string,
): LegalActions {
  const actor =
    match.actionIndex === null ? null : match.players[match.actionIndex];
  const player = match.players.find((item) => item.walletId === walletId);
  if (
    !player ||
    match.status !== "playing" ||
    match.street === "showdown" ||
    match.street === "complete" ||
    actor?.walletId !== walletId
  ) {
    return {
      canAct: false,
      toCall: 0,
      canCheck: false,
      canFold: false,
      canCall: false,
      minRaiseTo: 0,
      maxRaiseTo: 0,
    };
  }
  const toCall = Math.max(0, match.currentBet - player.bet);
  const maxRaiseTo = player.bet + player.stack;
  const minRaiseTo = Math.min(maxRaiseTo, match.currentBet + match.minRaise);
  return {
    canAct: true,
    toCall,
    canCheck: toCall === 0,
    canFold: true,
    canCall: toCall > 0,
    minRaiseTo,
    maxRaiseTo,
  };
}

export function applyAction(
  match: MatchState,
  walletId: string,
  input: ActionInput,
) {
  if (match.status !== "playing") throw new Error("Match is over");
  if (match.street === "showdown" || match.street === "complete") {
    throw new Error("Hand is over");
  }
  if (match.actionIndex === null) throw new Error("No action");
  const player = match.players[match.actionIndex]!;
  if (player.walletId !== walletId) throw new Error("Not your turn");

  const toCall = Math.max(0, match.currentBet - player.bet);

  if (input.type === "fold") {
    player.folded = true;
    player.lastAction = "Fold";
    player.actedThisStreet = true;
  } else if (input.type === "check") {
    if (toCall > 0) throw new Error("Cannot check");
    player.lastAction = "Check";
    player.actedThisStreet = true;
  } else if (input.type === "call") {
    const pay = Math.min(toCall, player.stack);
    player.stack -= pay;
    player.bet += pay;
    player.invested += pay;
    match.pot += pay;
    if (player.stack === 0) player.allIn = true;
    player.lastAction = player.allIn ? "All-in" : pay === 0 ? "Check" : `Call ${pay}`;
    player.actedThisStreet = true;
  } else if (input.type === "raise") {
    let raiseTo = Math.floor(input.raiseTo ?? 0);
    const maxTo = player.bet + player.stack;
    raiseTo = Math.min(maxTo, raiseTo);
    const allIn = raiseTo === maxTo;
    if (raiseTo <= player.bet) throw new Error("Raise too small");
    if (!allIn && raiseTo < match.currentBet + match.minRaise) {
      throw new Error(`Minimum raise is ${match.currentBet + match.minRaise}`);
    }
    const pay = raiseTo - player.bet;
    const raiseSize = raiseTo - match.currentBet;
    player.stack -= pay;
    player.bet += pay;
    player.invested += pay;
    match.pot += pay;
    if (player.stack === 0) player.allIn = true;
    if (raiseTo > match.currentBet) {
      if (raiseSize >= match.minRaise) match.minRaise = raiseSize;
      match.currentBet = raiseTo;
      match.lastAggressor = match.actionIndex;
      for (const other of match.players) {
        if (other !== player && !other.busted && !other.folded) {
          other.actedThisStreet = false;
        }
      }
    }
    player.lastAction = player.allIn ? "All-in" : `Raise ${raiseTo}`;
    player.actedThisStreet = true;
  } else {
    throw new Error("Unknown action");
  }

  advance(match);
}

function advance(match: MatchState) {
  const remaining = inHand(match);
  if (remaining.length === 1) {
    awardUncontested(match, remaining[0]!);
    return;
  }

  const actors = match.players.filter(canAct);
  const unmatched = actors.filter(
    (player) => !player.actedThisStreet || player.bet < match.currentBet,
  );
  if (actors.length === 0 || unmatched.length === 0) {
    if (match.board.length < 5 && actors.length <= 1) {
      beginRunout(match);
      return;
    }
    if (match.street === "river") {
      showdown(match);
      return;
    }
    nextStreet(match);
    return;
  }

  const next = nextIndex(match, match.actionIndex ?? 0, (player) => {
    if (!canAct(player)) return false;
    return !player.actedThisStreet || player.bet < match.currentBet;
  });
  match.actionIndex = next;
  match.actionDeadline = next === null ? null : Date.now() + ACTION_MS;
  if (next === null) {
    if (match.street === "river" || match.board.length >= 5) showdown(match);
    else if (match.players.filter(canAct).length <= 1) beginRunout(match);
    else nextStreet(match);
  }
}

function nextStreet(match: MatchState) {
  for (const player of match.players) {
    player.bet = 0;
    player.actedThisStreet = false;
    if (player.busted) player.lastAction = "Out";
    else if (player.folded) player.lastAction = "Fold";
    else player.lastAction = null;
  }
  match.currentBet = 0;
  match.minRaise = match.blinds.bb;
  match.lastAggressor = null;

  const deck = freshDeck(match);

  if (match.street === "preflop") {
    match.board.push(deck.pop()!, deck.pop()!, deck.pop()!);
    match.street = "flop";
  } else if (match.street === "flop") {
    match.board.push(deck.pop()!);
    match.street = "turn";
  } else if (match.street === "turn") {
    match.board.push(deck.pop()!);
    match.street = "river";
  } else {
    showdown(match);
    return;
  }

  const first = nextIndex(match, match.dealerIndex, canAct);
  match.actionIndex = first;
  match.actionDeadline = first === null ? null : Date.now() + ACTION_MS;
  if (first === null) beginRunout(match);
}

function runOutBoard(match: MatchState) {
  const deck = freshDeck(match);
  while (match.board.length < 5) match.board.push(deck.pop()!);
}

function awardUncontested(match: MatchState, winner: Player) {
  winner.stack += match.pot;
  match.winners = [{ walletId: winner.walletId, amount: match.pot }];
  log(match, `${short(winner.walletId)} wins ${match.pot}`);
  match.pot = 0;
  match.street = "showdown";
  match.actionIndex = null;
  match.actionDeadline = null;
  match.showdownAt = Date.now();
}

function showdown(match: MatchState) {
  match.runoutQueue = [];
  match.runoutAt = null;
  match.exposed = true;
  if (match.board.length < 5) runOutBoard(match);
  match.street = "showdown";
  match.actionIndex = null;
  match.actionDeadline = null;
  match.showdownAt = Date.now();

  const levels = [
    ...new Set(
      match.players.filter((player) => player.invested > 0).map((p) => p.invested),
    ),
  ].sort((a, b) => a - b);

  const merged = new Map<string, { amount: number; hand?: string }>();
  let prev = 0;
  for (const level of levels) {
    const inPot = match.players.filter((player) => player.invested >= level);
    const potSize = (level - prev) * inPot.length;
    const contenders = inPot.filter((player) => !player.folded && player.hole);
    prev = level;
    if (potSize <= 0 || contenders.length === 0) continue;

    let bests = [contenders[0]!];
    let bestVal = evaluate(contenders[0]!.hole!, match.board);
    for (const player of contenders.slice(1)) {
      const value = evaluate(player.hole!, match.board);
      const cmp = compareHands(value, bestVal);
      if (cmp > 0) {
        bests = [player];
        bestVal = value;
      } else if (cmp === 0) {
        bests.push(player);
      }
    }
    const share = Math.floor(potSize / bests.length);
    let remainder = potSize - share * bests.length;
    for (const player of bests) {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      const amount = share + extra;
      player.stack += amount;
      const current = merged.get(player.walletId) ?? { amount: 0 };
      current.amount += amount;
      current.hand = bestVal.name;
      merged.set(player.walletId, current);
    }
  }

  match.winners = [...merged.entries()].map(([walletId, value]) => ({
    walletId,
    amount: value.amount,
    hand: value.hand,
  }));
  match.pot = 0;
  if (match.winners.length) {
    log(
      match,
      match.winners
        .map((winner) => `${short(winner.walletId)} +${winner.amount}`)
        .join(" · "),
    );
  }
}

export function continueAfterShowdown(match: MatchState) {
  if (match.status !== "playing" || match.street !== "showdown") return;
  for (const player of match.players) {
    if (!player.busted && player.stack <= 0) {
      player.busted = true;
      player.folded = true;
      player.lastAction = "Out";
    }
  }
  if (living(match).length < 2) {
    finishMatch(match);
    return;
  }
  startHand(match);
}

export function timeoutAct(match: MatchState) {
  if (match.actionIndex === null) return;
  const player = match.players[match.actionIndex]!;
  const toCall = Math.max(0, match.currentBet - player.bet);
  applyAction(match, player.walletId, {
    type: toCall === 0 ? "check" : "fold",
  });
}

function finishMatch(match: MatchState) {
  match.status = "finished";
  match.street = "complete";
  match.actionIndex = null;
  match.actionDeadline = null;
  const champ = [...living(match)].sort((a, b) => b.stack - a.stack)[0];
  if (champ) {
    match.winners = [{ walletId: champ.walletId, amount: champ.stack }];
    log(match, `${short(champ.walletId)} wins the table`);
  }
}

function short(walletId: string) {
  return `${walletId.slice(0, 4)}…${walletId.slice(-4)}`;
}

function freshDeck(match: MatchState) {
  match.rngCounter += 1;
  const used = new Set<string>();
  for (const card of match.board) used.add(cardCode(card));
  for (const card of match.runoutQueue) used.add(cardCode(card));
  for (const player of match.players) {
    for (const card of player.hole ?? []) used.add(cardCode(card));
  }
  return seededShuffle(makeDeck(), match.seed, match.rngCounter).filter(
    (card) => !used.has(cardCode(card)),
  );
}

function remainingDeck(match: MatchState) {
  return freshDeck(match);
}

/** Peel the rest of the board one card at a time after an all-in. */
function beginRunout(match: MatchState) {
  if (match.runoutAt || match.runoutQueue.length > 0) return;
  match.exposed = true;
  match.actionIndex = null;
  match.actionDeadline = null;
  if (match.board.length >= 5) {
    showdown(match);
    return;
  }
  const deck = remainingDeck(match);
  while (match.board.length + match.runoutQueue.length < 5) {
    const card = deck.pop();
    if (!card) break;
    match.runoutQueue.push(card);
  }
  match.runoutAt = Date.now() + RUNOUT_MS;
}

export function stepRunout(match: MatchState) {
  if (!match.runoutAt || Date.now() < match.runoutAt) return false;
  const next = match.runoutQueue.shift();
  if (!next) {
    match.runoutAt = null;
    showdown(match);
    return true;
  }
  match.board.push(next);
  if (match.board.length <= 3) match.street = "flop";
  else if (match.board.length === 4) match.street = "turn";
  else match.street = "river";
  match.runoutAt = Date.now() + RUNOUT_MS;
  return true;
}

export function publicMatch(match: MatchState, viewer?: string) {
  const reveal =
    match.exposed || match.street === "showdown" || match.street === "complete";
  return {
    id: match.id,
    mode: match.mode,
    status: match.status,
    street: match.street,
    board: match.board.map(cardCode),
    pot: match.pot,
    currentBet: match.currentBet,
    minRaise: match.minRaise,
    blinds: match.blinds,
    handNumber: match.handNumber,
    dealerIndex: match.dealerIndex,
    actionIndex: match.actionIndex,
    actionDeadline: match.actionDeadline,
    winners: match.winners,
    log: match.log.slice(-12),
    commitHash: match.commitHash,
    revealSeed: match.status === "finished" ? match.seed : null,
    chain: match.chain ?? [],
    players: match.players.map((player) => {
      const mine = player.walletId === viewer;
      const show = Boolean(
        player.hole && (mine || (reveal && !player.folded)),
      );
      return {
        walletId: player.walletId,
        seat: player.seat,
        stack: player.stack,
        bet: player.bet,
        folded: player.folded,
        allIn: player.allIn,
        busted: player.busted,
        bot: player.bot,
        lastAction: player.lastAction,
        name: seatLabel(player.walletId),
        rank: player.rank || "Bronze",
        hole: player.hole
          ? show
            ? player.hole.map(cardCode)
            : ["BACK", "BACK"]
          : null,
      };
    }),
  };
}

export function privateView(match: MatchState, walletId: string) {
  const player = match.players.find((item) => item.walletId === walletId);
  const hole = player?.hole?.map(cardCode) ?? null;
  const handName = player?.hole ? evaluate(player.hole, match.board).name : null;
  return {
    hole,
    handName,
    legal: legalActions(match, walletId),
  };
}
