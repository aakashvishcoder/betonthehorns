import { revealMatch } from "./chain.js";
import { settleRatings, STARTING_ELO } from "./elo.js";
import {
  applySettlement,
  currentElos,
  escrowLocks,
  matchAlreadySettled,
  recordChainTxs,
} from "./schema.js";
import type { MatchState } from "./types.js";

const settled = new Set<string>();

export async function settleMatch(match: MatchState) {
  if (match.status !== "finished" || settled.has(match.id)) return;
  if (await matchAlreadySettled(match.id)) {
    settled.add(match.id);
    return;
  }
  settled.add(match.id);

  const humans = match.players.filter((player) => !player.bot);
  if (humans.length < 2) return;

  const ordered = [...humans].sort((a, b) => b.stack - a.stack);
  const placeOf = new Map<string, number>();
  ordered.forEach((player, index) => {
    const previous = index > 0 ? ordered[index - 1] : null;
    if (previous && previous.stack === player.stack) {
      placeOf.set(player.walletId, placeOf.get(previous.walletId)!);
    } else {
      placeOf.set(player.walletId, index + 1);
    }
  });

  let locks = new Map<string, number>();
  let elos = new Map(humans.map((player) => [player.walletId, STARTING_ELO]));
  try {
    locks = await escrowLocks(match.id);
    elos = await currentElos(
      humans.map((player) => player.walletId),
      match.mode,
    );
  } catch (error) {
    console.warn("[elo] read", (error as Error).message);
  }

  const results = settleRatings(
    humans.map((player) => {
      const current = elos.get(player.walletId) ?? STARTING_ELO;
      const lock = locks.get(player.walletId);
      const stake = lock?.stake ?? 0;
      const before = lock?.preElo ?? (lock ? current + stake : current);
      return {
        walletId: player.walletId,
        elo: before,
        place: placeOf.get(player.walletId) ?? humans.length,
        stake,
      };
    }),
  );
  const players = results.map((row) => ({
    walletId: row.walletId,
    elo: row.after,
    delta: row.delta,
    payout: row.payout,
    won: row.place === 1,
  }));

  try {
    await applySettlement({
      matchId: match.id,
      mode: match.mode,
      seed: match.seed,
      hands: match.handNumber,
      players,
    });
    const txs = await revealMatch({
      matchId: match.id,
      mode: match.mode,
      seed: match.seed,
      players: players.map((row) => ({
        walletId: row.walletId,
        elo: row.elo,
        payout: row.payout,
        hands: match.handNumber,
        won: row.won,
      })),
    });
    if (txs.length > 0) {
      await recordChainTxs(match.id, txs);
      const known = new Set(match.chain.map((tx) => tx.signature));
      for (const tx of txs) {
        if (!known.has(tx.signature)) match.chain.push(tx);
      }
      const { broadcastMatch } = await import("./matchmaking.js");
      await broadcastMatch(match).catch((error) =>
        console.warn("[chain] publish", (error as Error).message),
      );
    }
  } catch (error) {
    console.warn("[elo] settle", (error as Error).message);
    settled.delete(match.id);
  }
}
