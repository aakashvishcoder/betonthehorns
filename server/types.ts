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
  /** Ranked matches settle Elo on Solana; practice (vs AI) matches don't. */
  ranked: boolean;
  /** Secret shuffle seed (hex). Its sha256 is committed on-chain; revealed when the match ends. */
  seed: string;
  /** This hand's remaining deck, dealt from the end. Never sent to clients. */
  deck: Card[];
  /** Finishing place per wallet (1 = winner), filled in as players bust. */
  places: Record<string, number>;
  /** Stacks at the start of the current hand, to order same-hand busts. */
  handStartStacks: Record<string, number>;
  /** On-chain match id (u64 as string) once committed, or null if Solana was unavailable. */
  chainMatchId: string | null;
  /** Elo before/after per player once the ranked result is settled on-chain. */
  elo: { walletId: string; before: number; after: number }[] | null;
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

