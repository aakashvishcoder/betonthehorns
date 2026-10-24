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
  BACK: "ALL IN card back",
};
export const formatChips = (value: number) =>
  new Intl.NumberFormat("en-US").format(value);

// All fixtures below are fictional design data, never a live player or game record.
export const samplePlayer = {
  name: "Jamie",
  handle: "jamieplays",
  initials: "J",
  title: "Table regular",
  chips: 2450,
  games: 24,
  wins: 9,
  joined: "October 2026",
  bio: "Here for the good hands. Staying for the better company.",
};
export interface SampleGame {
  id: string;
  date: string;
  table: string;
  result: "Win" | "Loss";
  chipChange: number;
  players: number;
  duration: string;
  bestHand: string;
  cards: DeckCode[];
}
export const sampleGames: SampleGame[] = [
  {
    id: "night-01",
    date: "Oct 23, 2026",
    table: "Friday Night Crew",
    result: "Win",
    chipChange: 420,
    players: 6,
    duration: "48 min",
    bestHand: "Straight",
    cards: ["AS", "KH"],
  },
  {
    id: "night-02",
    date: "Oct 21, 2026",
    table: "The After Hours",
    result: "Loss",
    chipChange: -160,
    players: 4,
    duration: "32 min",
    bestHand: "High card",
    cards: ["AS", "QC"],
  },
  {
    id: "night-03",
    date: "Oct 19, 2026",
    table: "One More Hand",
    result: "Win",
    chipChange: 280,
    players: 6,
    duration: "41 min",
    bestHand: "Straight",
    cards: ["KH", "QC"],
  },
  {
    id: "night-04",
    date: "Oct 17, 2026",
    table: "Friday Night Crew",
    result: "Loss",
    chipChange: -90,
    players: 5,
    duration: "26 min",
    bestHand: "High card",
    cards: ["QC", "JC"],
  },
  {
    id: "night-05",
    date: "Oct 14, 2026",
    table: "Kitchen Table Club",
    result: "Win",
    chipChange: 350,
    players: 4,
    duration: "52 min",
    bestHand: "Flush",
    cards: ["JC", "TC"],
  },
  {
    id: "night-06",
    date: "Oct 12, 2026",
    table: "Sunday Slowplay",
    result: "Loss",
    chipChange: -120,
    players: 6,
    duration: "35 min",
    bestHand: "High card",
    cards: ["AS", "JC"],
  },
];
export interface SampleTable {
  id: string;
  name: string;
  description: string;
  category: "Casual" | "Private" | "Tournament";
  players: number;
  maxPlayers: number;
  blinds: string;
  buyIn: number;
  pace: string;
}
export const sampleTables: SampleTable[] = [
  {
    id: "friday",
    name: "Friday Night Crew",
    description: "Familiar faces. Very questionable poker faces.",
    category: "Casual",
    players: 4,
    maxPlayers: 6,
    blinds: "10 / 20",
    buyIn: 1000,
    pace: "Easygoing",
  },
  {
    id: "afterhours",
    name: "The After Hours",
    description: "One last hand. You know how that goes.",
    category: "Casual",
    players: 3,
    maxPlayers: 6,
    blinds: "25 / 50",
    buyIn: 2500,
    pace: "Steady",
  },
  {
    id: "kitchen",
    name: "Kitchen Table Club",
    description: "A private place for your favorite people.",
    category: "Private",
    players: 2,
    maxPlayers: 4,
    blinds: "10 / 20",
    buyIn: 1000,
    pace: "Easygoing",
  },
  {
    id: "showdown",
    name: "Sunday Showdown",
    description: "A little competition. All bragging rights.",
    category: "Tournament",
    players: 5,
    maxPlayers: 6,
    blinds: "50 / 100",
    buyIn: 5000,
    pace: "Focused",
  },
];
export const sampleStandings = [
  {
    name: "Alex",
    handle: "thequietbluff",
    chips: 8640,
    games: 32,
    wins: 14,
    change: 2,
  },
  {
    name: "River",
    handle: "onemorehand",
    chips: 7120,
    games: 29,
    wins: 12,
    change: 1,
  },
  {
    name: "Casey",
    handle: "pocketstories",
    chips: 6480,
    games: 27,
    wins: 11,
    change: -1,
  },
  {
    name: "Sam",
    handle: "slowplayclub",
    chips: 5290,
    games: 25,
    wins: 10,
    change: 0,
  },
  {
    name: "Morgan",
    handle: "callmealways",
    chips: 4170,
    games: 23,
    wins: 9,
    change: 3,
  },
  {
    name: "Jo",
    handle: "lateposition",
    chips: 3260,
    games: 21,
    wins: 8,
    change: -2,
  },
  {
    name: "Jamie",
    handle: "jamieplays",
    chips: 2450,
    games: 24,
    wins: 9,
    change: 1,
  },
  {
    name: "Taylor",
    handle: "goodcompany",
    chips: 1980,
    games: 18,
    wins: 6,
    change: 0,
  },
];
