import { gameModes, type GameModeId } from "@/lib/game-modes";
import { shortAddress } from "@/lib/utils";

export type DeckCode = "AS" | "KH" | "QC" | "JC" | "TC" | "BACK";

export const deckArt: Record<DeckCode, string> = {
  AS: "/cards/ace-spades.webp",
  KH: "/cards/king-hearts.webp",
  QC: "/cards/queen-clubs.webp",
  JC: "/cards/jack-clubs.webp",
  TC: "/cards/ten-clubs.webp",
  BACK: "/cards/allin-card-back.webp",
};
export const deckNames: Record<DeckCode, string> = {
  AS: "Ace of spades",
  KH: "King of hearts",
  QC: "Queen of clubs",
  JC: "Jack of clubs",
  TC: "Ten of clubs",
  BACK: "betonthehorns card back",
};
export const formatChips = (value: number) =>
  new Intl.NumberFormat("en-US").format(value);

export type EloRank = "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond";

export function rankFromElo(elo: number): EloRank {
  if (elo >= 1900) return "Diamond";
  if (elo >= 1700) return "Platinum";
  if (elo >= 1500) return "Gold";
  if (elo >= 1300) return "Silver";
  return "Bronze";
}

export type ModeStats = {
  elo: number;
  rank: EloRank;
  games: number;
  wins: number;
  handsWon: number;
  handsFolded: number;
};

export type Milestone = {
  id: string;
  label: string;
  detail: string;
  earned: boolean;
};

export type DemoPlayer = {
  address: string;
  name: string;
  handle: string;
  modes: Record<GameModeId, ModeStats>;
  change: Record<GameModeId, number>;
};

export type SampleGame = {
  id: string;
  date: string;
  mode: GameModeId;
  result: "Win" | "Loss";
  eloChange: number;
  players: number;
  duration: string;
  bestHand: string;
  cards: DeckCode[];
};

function modeStats(
  elo: number,
  games: number,
  wins: number,
  handsWon: number,
  handsFolded: number,
): ModeStats {
  return {
    elo,
    rank: rankFromElo(elo),
    games,
    wins,
    handsWon,
    handsFolded,
  };
}

function hashAddress(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

export const demoPlayers: DemoPlayer[] = [
  {
    address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    name: "Alex",
    handle: "thequietbluff",
    modes: {
      "hands-up": modeStats(1864, 41, 23, 310, 188),
      "sng-4": modeStats(1722, 28, 9, 214, 160),
      "sng-6": modeStats(1648, 22, 5, 198, 171),
    },
    change: { "hands-up": 2, "sng-4": 1, "sng-6": 0 },
  },
  {
    address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    name: "River",
    handle: "onemorehand",
    modes: {
      "hands-up": modeStats(1710, 36, 19, 274, 201),
      "sng-4": modeStats(1814, 31, 11, 248, 142),
      "sng-6": modeStats(1590, 18, 4, 166, 154),
    },
    change: { "hands-up": 1, "sng-4": 3, "sng-6": -1 },
  },
  {
    address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T",
    name: "Casey",
    handle: "pocketstories",
    modes: {
      "hands-up": modeStats(1542, 29, 14, 221, 176),
      "sng-4": modeStats(1488, 24, 7, 190, 168),
      "sng-6": modeStats(1766, 27, 7, 240, 133),
    },
    change: { "hands-up": -1, "sng-4": 0, "sng-6": 2 },
  },
  {
    address: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
    name: "Sam",
    handle: "slowplayclub",
    modes: {
      "hands-up": modeStats(1426, 22, 10, 168, 149),
      "sng-4": modeStats(1604, 20, 6, 176, 151),
      "sng-6": modeStats(1512, 19, 4, 172, 163),
    },
    change: { "hands-up": 0, "sng-4": -2, "sng-6": 1 },
  },
  {
    address: "2qEHjDLDKizq1LDmXwRhq4MyjR8gKqzq7k1vQ4n8mY3P",
    name: "Morgan",
    handle: "callmealways",
    modes: {
      "hands-up": modeStats(1388, 18, 8, 140, 132),
      "sng-4": modeStats(1334, 16, 4, 128, 140),
      "sng-6": modeStats(1460, 17, 3, 154, 147),
    },
    change: { "hands-up": 3, "sng-4": 1, "sng-6": 0 },
  },
  {
    address: "5uD2kM8nR4wL9pQ6tY1cB7vX3hJ0sA8fE2gN6zP4dW9K",
    name: "Jo",
    handle: "lateposition",
    modes: {
      "hands-up": modeStats(1294, 15, 6, 112, 121),
      "sng-4": modeStats(1410, 14, 3, 118, 129),
      "sng-6": modeStats(1366, 15, 2, 126, 138),
    },
    change: { "hands-up": -2, "sng-4": 0, "sng-6": -1 },
  },
];

export const sampleGames: SampleGame[] = [
  {
    id: "night-01",
    date: "Oct 23, 2026",
    mode: "hands-up",
    result: "Win",
    eloChange: 18,
    players: 2,
    duration: "22 min",
    bestHand: "Straight",
    cards: ["AS", "KH"],
  },
  {
    id: "night-02",
    date: "Oct 21, 2026",
    mode: "sng-4",
    result: "Loss",
    eloChange: -14,
    players: 4,
    duration: "38 min",
    bestHand: "High card",
    cards: ["AS", "QC"],
  },
  {
    id: "night-03",
    date: "Oct 19, 2026",
    mode: "sng-6",
    result: "Win",
    eloChange: 26,
    players: 6,
    duration: "51 min",
    bestHand: "Straight",
    cards: ["KH", "QC"],
  },
  {
    id: "night-04",
    date: "Oct 17, 2026",
    mode: "hands-up",
    result: "Loss",
    eloChange: -12,
    players: 2,
    duration: "18 min",
    bestHand: "High card",
    cards: ["QC", "JC"],
  },
  {
    id: "night-05",
    date: "Oct 14, 2026",
    mode: "sng-4",
    result: "Win",
    eloChange: 21,
    players: 4,
    duration: "41 min",
    bestHand: "Flush",
    cards: ["JC", "TC"],
  },
  {
    id: "night-06",
    date: "Oct 12, 2026",
    mode: "sng-6",
    result: "Loss",
    eloChange: -16,
    players: 6,
    duration: "44 min",
    bestHand: "High card",
    cards: ["AS", "JC"],
  },
];

export function demoPlayerFromAddress(address: string): DemoPlayer {
  const existing = demoPlayers.find((player) => player.address === address);
  if (existing) return existing;

  const seed = hashAddress(address);
  const modes = Object.fromEntries(
    gameModes.map((mode, index) => {
      const elo = 1180 + ((seed >> (index * 5)) % 620);
      const games = 6 + ((seed >> (index * 3)) % 28);
      const wins = Math.max(1, Math.round(games * (0.28 + (index % 3) * 0.06)));
      return [
        mode.id,
        modeStats(
          elo,
          games,
          wins,
          wins * 8 + ((seed >> index) % 40),
          games * 6 + ((seed >> (index + 2)) % 50),
        ),
      ];
    }),
  ) as Record<GameModeId, ModeStats>;

  return {
    address,
    name: shortAddress(address),
    handle: address.slice(0, 8).toLowerCase(),
    modes,
    change: { "hands-up": 0, "sng-4": 0, "sng-6": 0 },
  };
}

export function playerMilestones(player: DemoPlayer): Milestone[] {
  const handsWon = gameModes.reduce(
    (total, mode) => total + player.modes[mode.id].handsWon,
    0,
  );
  const handsFolded = gameModes.reduce(
    (total, mode) => total + player.modes[mode.id].handsFolded,
    0,
  );
  const ranks = gameModes.map((mode) => player.modes[mode.id].rank);

  return [
    {
      id: "hands-won-50",
      label: "Fifty pots",
      detail: "Win 50 hands",
      earned: handsWon >= 50,
    },
    {
      id: "hands-won-200",
      label: "Two hundred pots",
      detail: "Win 200 hands",
      earned: handsWon >= 200,
    },
    {
      id: "hands-folded-100",
      label: "Know when to walk",
      detail: "Fold 100 hands",
      earned: handsFolded >= 100,
    },
    {
      id: "gold-any",
      label: "Gold horn",
      detail: "Reach Gold ELO in any mode",
      earned: ranks.some((rank) =>
        ["Gold", "Platinum", "Diamond"].includes(rank),
      ),
    },
    {
      id: "rank-all",
      label: "Three ranks minted",
      detail: "Hold a rank dNFT in every mode",
      earned: ranks.every(Boolean),
    },
  ];
}

export function standingsForMode(mode: GameModeId) {
  return [...demoPlayers]
    .sort((a, b) => b.modes[mode].elo - a.modes[mode].elo)
    .map((player, index) => ({
      ...player,
      rank: index + 1,
      elo: player.modes[mode].elo,
      games: player.modes[mode].games,
      wins: player.modes[mode].wins,
      move: player.change[mode],
      rankBadge: player.modes[mode].rank,
    }));
}
