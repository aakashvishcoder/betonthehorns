import { HAND_MILESTONES, rankFromElo, WIN_MILESTONES } from "./elo.js";
import { MODES, type GameMode } from "./types.js";

export type Badge = {
  key: string;
  kind: "hands" | "wins" | "rank";
  label: string;
  detail: string;
  mode: GameMode | null;
  /** Rank tier for an ELO dNFT. Hands and win badges leave this empty. */
  tier: string | null;
  earned: boolean;
  shown: boolean;
};

const MODE_LABEL: Record<GameMode, string> = {
  "hands-up": "Hands Up",
  "sng-4": "SNG 4",
  "sng-6": "SNG 6",
};

export function buildBadges(input: {
  modes: { mode: GameMode; elo: number; games: number }[];
  hands: number;
  wins: number;
  showcase: Map<string, boolean>;
}): Badge[] {
  const shown = (key: string, earned: boolean) => {
    if (!earned) return false;
    if (input.showcase.has(key)) return input.showcase.get(key) === true;
    return true;
  };

  const badges: Badge[] = [];
  for (const hands of HAND_MILESTONES) {
    const earned = input.hands >= hands;
    const key = `hands:${hands}`;
    badges.push({
      key,
      kind: "hands",
      label: `${hands.toLocaleString()} hands`,
      detail: "Hands played",
      mode: null,
      tier: null,
      earned,
      shown: shown(key, earned),
    });
  }
  for (const wins of WIN_MILESTONES) {
    const earned = input.wins >= wins;
    const key = `wins:${wins}`;
    badges.push({
      key,
      kind: "wins",
      label: `${wins.toLocaleString()} wins`,
      detail: "Games won",
      mode: null,
      tier: null,
      earned,
      shown: shown(key, earned),
    });
  }
  for (const mode of MODES) {
    const row = input.modes.find((item) => item.mode === mode);
    const elo = row?.elo ?? 1200;
    const earned = (row?.games ?? 0) > 0;
    const rank = rankFromElo(elo);
    const key = `rank:${mode}`;
    badges.push({
      key,
      kind: "rank",
      label: `${rank} · ${MODE_LABEL[mode]}`,
      detail: `${elo.toLocaleString()} ELO`,
      mode,
      tier: rank,
      earned,
      shown: shown(key, earned),
    });
  }
  return badges;
}
