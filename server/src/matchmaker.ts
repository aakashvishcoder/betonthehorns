export const MODES = { heads_up: 2, four: 4, six: 6 } as const;
export type Mode = keyof typeof MODES;

type Entry = { id: string; rating: number; joinedAt: number };

export const BASE_RANGE = 100;
export const RANGE_STEP = 50;
export const RANGE_STEP_MS = 15_000;

/** Elo gap a player accepts after waiting: ±100, widening by 50 every 15 s. */
export const rangeOf = (entry: Entry, now: number) =>
  BASE_RANGE + RANGE_STEP * Math.floor(Math.max(0, now - entry.joinedAt) / RANGE_STEP_MS);

/** Ranked queues, one per mode. Call `tick` periodically to form tables. */
export class Matchmaker {
  private readonly queues = new Map<Mode, Entry[]>(Object.keys(MODES).map(m => [m as Mode, []]));

  join(mode: Mode, id: string, rating: number, now: number) {
    if (this.modeOf(id)) throw new Error("already queued");
    this.queues.get(mode)!.push({ id, rating, joinedAt: now });
  }

  leave(id: string) {
    for (const [mode, queue] of this.queues) this.queues.set(mode, queue.filter(e => e.id !== id));
  }

  modeOf(id: string): Mode | undefined {
    return [...this.queues].find(([, q]) => q.some(e => e.id === id))?.[0];
  }

  waiting(mode: Mode) {
    return this.queues.get(mode)!.length;
  }

  /** Forms as many tables as possible; seated players leave the queue. */
  tick(now: number): { mode: Mode; players: string[] }[] {
    const tables: { mode: Mode; players: string[] }[] = [];
    for (const [mode, queue] of this.queues) {
      const size = MODES[mode];
      // Longest-waiting player anchors each search.
      const remaining = [...queue].sort((a, b) => a.joinedAt - b.joinedAt);
      const seated = new Set<string>();
      for (const anchor of remaining) {
        if (seated.has(anchor.id)) continue;
        const fits = (a: Entry, b: Entry) => Math.abs(a.rating - b.rating) <= Math.min(rangeOf(a, now), rangeOf(b, now));
        const group = [anchor];
        const candidates = remaining
          .filter(e => e !== anchor && !seated.has(e.id) && fits(anchor, e))
          .sort((a, b) => Math.abs(a.rating - anchor.rating) - Math.abs(b.rating - anchor.rating));
        for (const c of candidates) {
          if (group.length === size) break;
          if (group.every(g => fits(g, c))) group.push(c);
        }
        if (group.length === size) {
          group.forEach(g => seated.add(g.id));
          tables.push({ mode, players: group.map(g => g.id) });
        }
      }
      this.queues.set(mode, queue.filter(e => !seated.has(e.id)));
    }
    return tables;
  }
}
