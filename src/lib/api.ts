import type { GameModeId } from "@/lib/game-modes";
import { SESSION_EXPIRED, sessionHeader } from "@/lib/session";

const base = import.meta.env.VITE_API_URL ?? "";

export type PublicPlayer = {
  walletId: string;
  seat: number;
  stack: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  busted: boolean;
  bot: boolean;
  lastAction: string | null;
  name: string;
  rank: string;
  hole: string[] | null;
};

export type PublicMatch = {
  id: string;
  mode: GameModeId;
  status: "playing" | "finished";
  street: string;
  board: string[];
  pot: number;
  currentBet: number;
  minRaise: number;
  blinds: { sb: number; bb: number };
  handNumber: number;
  dealerIndex: number;
  actionIndex: number | null;
  actionDeadline: number | null;
  winners: { walletId: string; amount: number; hand?: string }[];
  log: string[];
  commitHash: string;
  revealSeed: string | null;
  chain: ChainTx[];
  revision?: number;
  players: PublicPlayer[];
  /** Ranked matches settle Elo; practice (vs AI) matches don't. */
  ranked: boolean;
  /** Finishing place per wallet (1 = winner), filled in as players bust. */
  places: Record<string, number>;
};

export type ChainTx = {
  label: string;
  signature: string;
};

export type ProfileMode = {
  mode: GameModeId;
  elo: number;
  rank: string;
  games: number;
  wins: number;
  hands: number;
};

export type ProfileBadge = {
  key: string;
  kind: "hands" | "wins" | "rank";
  label: string;
  detail: string;
  mode: GameModeId | null;
  tier: string | null;
  earned: boolean;
  shown: boolean;
};

export type PublicProfile = {
  address: string;
  displayName: string | null;
  modes: ProfileMode[];
  hands: number;
  wins: number;
  games: number;
  recent: {
    time: string;
    mode: GameModeId;
    elo: number;
    delta: number;
    matchId: string | null;
    commitHash: string | null;
    revealSeed: string | null;
    chain: ChainTx[];
  }[];
  badges: ProfileBadge[];
};

export type LeaderboardRow = {
  address: string;
  name: string | null;
  elo: number;
  games: number;
  wins: number;
  move: number;
  place: number;
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

export type PrivateView = {
  hole: string[] | null;
  handName: string | null;
  legal: LegalActions;
};

export type ChatMessage = { name: string; text: string; at: number };

export type QueueSnapshot = {
  mode: GameModeId;
  seats: number;
  count: number;
  wallets: string[];
};

export type PuzzleChoice = "fold" | "call" | "shove";
export type Puzzle = {
  id: string;
  day: string;
  index: number;
  kind: "draw" | "shove" | "defend";
  difficulty: "easy" | "medium" | "hard";
  title: string;
  street: "preflop" | "turn";
  hero: string[];
  board: string[];
  position: string;
  situation: string;
  assumption: string;
  pot: number;
  toCall: number;
  bigBlind: number;
  heroStack: number;
  options: { id: PuzzleChoice; label: string }[];
};
export type PuzzleSolution = {
  answer: PuzzleChoice;
  explanation: string;
  numbers: { label: string; value: string }[];
};
export type PuzzleResult = {
  index: number;
  choice: PuzzleChoice;
  correct: boolean;
  solution: PuzzleSolution;
};

export type AnalysisKind = "match" | "puzzles";
export type Analysis = {
  grade: string;
  headline: string;
  summary: string;
  strengths: string[];
  leaks: string[];
  keyHands: { ref: string; title: string; youDid: string; better: string; why: string }[];
  focus: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...sessionHeader(),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    window.dispatchEvent(new Event(SESSION_EXPIRED));
  }
  if (!response.ok) {
    throw Object.assign(new Error(data.error || response.statusText), { status: response.status, body: data });
  }
  return data;
}

export const api = {
  savedAnalysis: (kind: AnalysisKind, ref: string) =>
    request<{ analysis: Analysis | null }>(`/api/analysis/${kind}/${ref}`),
  runAnalysis: (kind: AnalysisKind, ref: string) =>
    request<{ analysis: Analysis }>(`/api/analysis/${kind}/${ref}`, { method: "POST" }),
  puzzlesToday: () =>
    request<{ day: string; puzzles: Puzzle[]; attempts: PuzzleResult[]; streak: number }>("/api/puzzles/today"),
  answerPuzzle: (day: string, index: number, choice: PuzzleChoice) =>
    request<PuzzleResult & { saved: boolean; streak: number }>("/api/puzzles/answer", {
      method: "POST",
      body: JSON.stringify({ day, index, choice }),
    }),
  puzzleLeaderboard: () =>
    request<{ day: string; rows: { walletId: string; correct: number; answered: number; name: string }[] }>(
      "/api/puzzles/leaderboard",
    ),
  health: () => request<{ ok: boolean; db: boolean }>("/api/health"),
  authChallenge: (walletId: string) =>
    request<{ nonce: string; message: string }>(`/api/auth/challenge/${walletId}`),
  login: (walletId: string, signature: string, nonce: string) =>
    request<{ walletId: string; token: string; expires: number }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ walletId, signature, nonce }),
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  wallet: (walletId: string) =>
    request<{
      walletId: string;
      displayName: string | null;
      eloHistory: Record<GameModeId, { time: string; elo: number; matchId: string | null }[]>;
    }>(`/api/wallet/${walletId}`),
  leaderboard: (mode: GameModeId) =>
    request<{ mode: GameModeId; rows: LeaderboardRow[] }>(`/api/leaderboard/${mode}`),
  profile: (walletId: string) => request<PublicProfile>(`/api/profile/${walletId}`),
  setShowcase: (walletId: string, shown: string[]) =>
    request<PublicProfile>("/api/profile/showcase", {
      method: "POST",
      body: JSON.stringify({ walletId, shown }),
    }),
  setDisplayName: (walletId: string, displayName: string) =>
    request<{ walletId: string; displayName: string | null }>("/api/profile/name", {
      method: "POST",
      body: JSON.stringify({ walletId, displayName }),
    }),
  ablyToken: (walletId: string) =>
    request<unknown>("/api/ably/token", {
      method: "POST",
      body: JSON.stringify({ walletId }),
    }),
  queue: (mode: GameModeId) => request<QueueSnapshot>(`/api/queue/${mode}`),
  practice: (mode: GameModeId) =>
    request<{ matchId: string }>("/api/practice", {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),
  joinQueue: (walletId: string, mode: GameModeId) =>
    request<{
      status: "queued" | "playing";
      matchId: string | null;
      queue: QueueSnapshot;
    }>("/api/queue", {
      method: "POST",
      body: JSON.stringify({ walletId, mode }),
    }),
  leaveQueue: (walletId: string) =>
    request<{ ok: boolean }>("/api/queue", {
      method: "DELETE",
      body: JSON.stringify({ walletId }),
    }),
  match: (id: string, walletId: string) =>
    request<{ match: PublicMatch; you: PrivateView | null; chat: ChatMessage[] }>(
      `/api/match/${id}?walletId=${encodeURIComponent(walletId)}`,
    ),
  activeMatch: (walletId: string) =>
    request<{ match: PublicMatch | null; you?: PrivateView; chat?: ChatMessage[] }>(
      `/api/match/active/${walletId}`,
    ),
  action: (
    matchId: string,
    walletId: string,
    type: "fold" | "check" | "call" | "raise",
    raiseTo?: number,
  ) =>
    request<{ match: PublicMatch; you: PrivateView }>(`/api/match/${matchId}/action`, {
      method: "POST",
      body: JSON.stringify({ walletId, type, raiseTo }),
    }),
  chat: (matchId: string, walletId: string, text: string) =>
    request<{ messages: ChatMessage[] }>(`/api/match/${matchId}/chat`, {
      method: "POST",
      body: JSON.stringify({ walletId, text }),
    }),
};
