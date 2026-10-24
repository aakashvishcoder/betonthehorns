/** Ranked formats. Each mode keeps its own ELO. */
export const gameModes = [
  {
    id: "hands-up",
    label: "Hands Up",
    seats: 2,
    tagline: "Heads-up Hold’em. One seat across from you.",
    escrow: 24,
  },
  {
    id: "sng-4",
    label: "SNG 4",
    seats: 4,
    tagline: "Sit-and-go. Four seats. Winner takes the escrowed ELO.",
    escrow: 32,
  },
  {
    id: "sng-6",
    label: "SNG 6",
    seats: 6,
    tagline: "Sit-and-go. Six seats. Bigger field, same ranked stake.",
    escrow: 40,
  },
] as const;

export type GameModeId = (typeof gameModes)[number]["id"];

export function isGameModeId(value: string): value is GameModeId {
  return gameModes.some((mode) => mode.id === value);
}

export function getGameMode(id: string) {
  return gameModes.find((mode) => mode.id === id) ?? gameModes[0];
}
