import { type Style, clamp } from "./style.ts";

export type Persona = {
  id: "rock" | "maniac" | "shark";
  name: string;
  /** Snowflake Cortex model this persona thinks with (override with CORTEX_MODEL_<ID>). */
  model: string;
  /** How the persona plays relative to the player it mirrors. */
  shift: (player: Style) => Style;
  voice: string;
};

export const PERSONAS: Persona[] = [
  {
    id: "shark",
    name: "The Shark",
    model: process.env.CORTEX_MODEL_SHARK ?? "claude-haiku-4-5",
    // Your habits, played sharper: a bit tighter preflop, more aggressive after.
    shift: p => ({ ...p, vpip: clamp(p.vpip * 0.9, 0.12, 0.6), pfr: clamp(p.pfr * 1.2, 0.05, 0.5), aggression: clamp(p.aggression * 1.2, 0.5, 5) }),
    voice: "a calm, patient winning player who exploits mistakes and rarely tilts",
  },
  {
    id: "maniac",
    name: "The Maniac",
    model: process.env.CORTEX_MODEL_MANIAC ?? "openai-gpt-5-nano",
    // Your habits turned up: plays more hands and bets far more often.
    shift: p => ({ ...p, vpip: clamp(p.vpip * 1.4, 0.2, 0.85), pfr: clamp(p.pfr * 1.8, 0.1, 0.6), aggression: clamp(p.aggression * 1.7, 1, 6) }),
    voice: "a loose, aggressive gambler who loves pressure, raises light and bluffs often",
  },
  {
    id: "rock",
    name: "The Rock",
    model: process.env.CORTEX_MODEL_ROCK ?? "llama3.1-8b",
    // Your habits turned down: fewer hands, more calling than raising.
    shift: p => ({ ...p, vpip: clamp(p.vpip * 0.65, 0.08, 0.4), pfr: clamp(p.pfr * 0.7, 0.03, 0.3), aggression: clamp(p.aggression * 0.7, 0.3, 3) }),
    voice: "a tight, cautious player who waits for strong hands and rarely bluffs",
  },
];

/** AI seat ids look like "ai:shark:1". */
export const aiSeatId = (persona: Persona, n: number) => `ai:${persona.id}:${n}`;
export const isAi = (id: string) => id.startsWith("ai:");
export const personaOf = (id: string) => PERSONAS.find(p => p.id === id.split(":")[1]);

/** Display name for an AI seat: "The Shark", "The Shark 2", … */
export function aiName(id: string) {
  const [, , n] = id.split(":");
  const persona = personaOf(id);
  return persona ? `${persona.name}${n && n !== "1" ? ` ${n}` : ""}` : id;
}

/** Seat ids for the AIs filling a table: Shark, Maniac, Rock, then repeats. */
export function aiSeats(count: number): string[] {
  return Array.from({ length: count }, (_, i) => aiSeatId(PERSONAS[i % PERSONAS.length]!, Math.floor(i / PERSONAS.length) + 1));
}
