// Same integer Elo as the on-chain program (anchor/programs/horns_elo/src/elo.rs), so the
// local prototype produces identical ratings: pairwise by finish place, K = 32.

export const STARTING_RATING = 1200;
const K = 32;
const MAX_DIFF = 800;
const STEP = 25;
const EXPECTED_BPS = [
  5000, 5359, 5715, 6063, 6401, 6725, 7034, 7325, 7597, 7850, 8083, 8296, 8490, 8666, 8823, 8965, 9091, 9203, 9302, 9390, 9468,
  9536, 9595, 9648, 9693, 9733, 9768, 9799, 9825, 9848, 9868, 9886, 9901,
];

export function expectedBps(diff: number): number {
  const d = Math.min(Math.abs(diff), MAX_DIFF);
  const i = Math.floor(d / STEP);
  const lo = EXPECTED_BPS[i]!;
  const hi = EXPECTED_BPS[i + 1] ?? lo;
  const value = lo + Math.floor(((hi - lo) * (d % STEP)) / STEP);
  return diff >= 0 ? value : 10_000 - value;
}

/** Rating change per player; `places[i]` is player i's finish (1 = best), equal places draw. */
export function ratingDeltas(ratings: number[], places: number[]): number[] {
  const n = ratings.length;
  return ratings.map((ri, i) => {
    let surplus = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const actual = places[i]! < places[j]! ? 10_000 : places[i] === places[j] ? 5_000 : 0;
      surplus += actual - expectedBps(ri - ratings[j]!);
    }
    const num = K * surplus;
    const den = (n - 1) * 10_000;
    return Math.trunc((num + Math.sign(num) * (den / 2)) / den); // round half away from zero, like the Rust
  });
}
