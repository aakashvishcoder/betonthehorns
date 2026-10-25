import type { HistoryHand } from "./history.js";
import type { Style } from "./src/ai/style.ts";

export const MODES = ["hands-up", "sng-4", "sng-6"] as const;
export type GameMode = (typeof MODES)[number];

export const MODE_SEATS: Record<GameMode, number> = {
  "hands-up": 2,
  "sng-4": 4,
  "sng-6": 6,
};

export type Card = {
  rank: number;
  suit: "S" | "H" | "D" | "C";
};

export type Street =
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown"
  | "complete";

export type Player = {
  walletId: string;
  seat: number;
  stack: number;
  hole: Card[] | null;
  bet: number;
  invested: number;
  folded: boolean;
  allIn: boolean;
  busted: boolean;
  bot: boolean;
  lastAction: string | null;
  actedThisStreet: boolean;
  /** Rank tier for this match's mode, from the rating they sat down with. */
  rank: string;
};

export type ChainTx = {
  label: string;
  signature: string;
};

export type MatchState = {
  id: string;
  mode: GameMode;
  status: "playing" | "finished";
  players: Player[];
  dealerIndex: number;
  street: Street;
  board: Card[];
  pot: number;
  currentBet: number;
  minRaise: number;
  actionIndex: number | null;
  lastAggressor: number | null;
  handNumber: number;
  blinds: { sb: number; bb: number };
  winners: { walletId: string; amount: number; hand?: string }[];
  startedAt: number;
  showdownAt: number | null;
  actionDeadline: number | null;
  /** Cards still to peel off during an all-in runout. */
  runoutQueue: Card[];
  runoutAt: number | null;
  /** Hole cards are face up while the board runs out. */
  exposed: boolean;
  log: string[];
  /** Confirmed Solana transactions for this match, in the order they landed. */
  chain: ChainTx[];
  /** sha256 of the match seed. Public for the whole game. */
  commitHash: string;
  /** Private until the match finishes, then published so the shuffle can be checked. */
  seed: string;
  rngCounter: number;
  /** Bumped on every broadcast so a late device can ignore an older snapshot. */
  revision: number;
  /** Ranked matches settle Elo; practice (vs AI) matches don't. */
  ranked: boolean;
  /** Finishing place per wallet (1 = winner), filled in as players bust. */
  places: Record<string, number>;
  /** Stacks at the start of the current hand, to order same-hand busts. */
  handStartStacks: Record<string, number>;
  /**
   * Everything below lives in the match (saved as live_state) rather than in a server's memory,
   * so any serverless instance can carry the game on.
   */
  /** Hand-by-hand record for post-game analysis and play-style stats. */
  history?: HistoryHand[];
  /** Practice: the mirrored style and skill the AI seats play with. */
  ai?: { style: Style; skill: number };
  /** When anything last happened at the table (AI seats wait a beat after it). */
  lastActionAt?: number;
  /** Per human: when they last acted themselves, and timeouts in a row since. */
  away?: Record<string, { lastActed: number; timeouts: number }>;
  /** Humans who were away too long; their chips leave the game at the end of the hand. */
  forfeited?: string[];
};

export type ActionType = "fold" | "check" | "call" | "raise";

export type ActionInput = {
  type: ActionType;
  raiseTo?: number;
};

export type LegalActions = {
  canAct: boolean;
  toCall: number;
  canCheck: boolean;
  canFold: boolean;
  canCall: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
};

