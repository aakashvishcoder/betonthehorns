export type DeckCode = "AS" | "KH" | "QC" | "JC" | "TC" | "BACK";

export const deckArt: Record<DeckCode, string> = {
  AS: "/cards/ace-spades.webp",
  KH: "/cards/king-hearts.webp",
  QC: "/cards/queen-clubs.webp",
  JC: "/cards/jack-clubs.webp",
  TC: "/cards/ten-clubs.webp",
  BACK: "/cards/horns-card-back.webp",
};
const FACE_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"] as const;
const FACE_SUITS = ["S", "H", "D", "C"] as const;

const rankNames: Record<string, string> = {
  A: "Ace",
  K: "King",
  Q: "Queen",
  J: "Jack",
  T: "Ten",
  "9": "Nine",
  "8": "Eight",
  "7": "Seven",
  "6": "Six",
  "5": "Five",
  "4": "Four",
  "3": "Three",
  "2": "Two",
};
const suitNames: Record<string, string> = {
  S: "spades",
  H: "hearts",
  D: "diamonds",
  C: "clubs",
};

export function cardArt(code: string) {
  const rank = code?.[0];
  const suit = code?.[1];
  if (
    FACE_RANKS.includes(rank as (typeof FACE_RANKS)[number]) &&
    FACE_SUITS.includes(suit as (typeof FACE_SUITS)[number])
  ) {
    return `/cards/deck/${rank}${suit}.webp`;
  }
  return deckArt.BACK;
}

export function cardName(code: string) {
  if (!code || code === "BACK") return "Face-down card";
  const rank = rankNames[code[0] ?? ""] ?? code[0];
  const suit = suitNames[code[1] ?? ""] ?? "cards";
  return `${rank} of ${suit}`;
}

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

export type EloRank = "Bronze" | "Silver" | "Gold" | "Diamond" | "Platinum";

export function rankFromElo(elo: number): EloRank {
  if (elo <= 1500) return "Bronze";
  if (elo <= 1800) return "Silver";
  if (elo <= 2000) return "Gold";
  if (elo <= 2200) return "Diamond";
  return "Platinum";
}
