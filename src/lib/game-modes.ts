/** Ranked formats. Each mode keeps its own ELO. */
export const gameModes = [
  {
    id: "hands-up",
    label: "Hands Up",
    seats: 2,
    tagline: "Heads-up Hold’em. Its own ELO, separate from the sit-and-gos.",
  },
  {
    id: "sng-4",
    label: "SNG 4",
    seats: 4,
    tagline: "Sit-and-go. Four seats. A separate ELO from Hands Up and SNG 6.",
  },
  {
    id: "sng-6",
    label: "SNG 6",
    seats: 6,
    tagline: "Sit-and-go. Six seats. Its own ladder.",
  },
] as const;

export type GameModeId = (typeof gameModes)[number]["id"];

export function isGameModeId(value: string): value is GameModeId {
  return gameModes.some((mode) => mode.id === value);
}

export function getGameMode(id: string) {
  return gameModes.find((mode) => mode.id === id) ?? gameModes[0];
}
