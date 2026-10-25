import { type Card, FULL_DECK } from "../cards.ts";
import { evaluate } from "../evaluate.ts";

/**
 * Monte Carlo equity: the share of random run-outs where `hole` wins (ties split)
 * against `opponents` unknown hands, given the cards on the board.
 */
export function equity(hole: Card[], board: Card[], opponents: number, iterations = 300, random = Math.random): number {
  if (opponents < 1) return 1;
  const known = new Set([...hole, ...board]);
  const rest = FULL_DECK.filter(c => !known.has(c));
  const needed = 5 - board.length + 2 * opponents;
  let score = 0;
  for (let it = 0; it < iterations; it++) {
    // Partial Fisher-Yates: draw only the cards this run-out needs.
    for (let i = 0; i < needed; i++) {
      const j = i + Math.floor(random() * (rest.length - i));
      [rest[i], rest[j]] = [rest[j]!, rest[i]!];
    }
    const runout = [...board, ...rest.slice(0, 5 - board.length)];
    const mine = evaluate([...hole, ...runout]).score;
    let best = 0;
    let ties = 0;
    for (let o = 0; o < opponents; o++) {
      const offset = 5 - board.length + 2 * o;
      const theirs = evaluate([rest[offset]!, rest[offset + 1]!, ...runout]).score;
      if (theirs > best) best = theirs;
    }
    if (mine > best) score += 1;
    else if (mine === best) {
      for (let o = 0; o < opponents; o++) {
        const offset = 5 - board.length + 2 * o;
        if (evaluate([rest[offset]!, rest[offset + 1]!, ...runout]).score === mine) ties++;
      }
      score += 1 / (ties + 1);
    }
  }
  return score / iterations;
}
