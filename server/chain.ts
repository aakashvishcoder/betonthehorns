import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
import type { Mode } from "./src/matchmaker.ts";
import { SolanaChain } from "./src/solana-chain.ts";
import { appendEloHistory, dbReady } from "./schema.js";
import type { GameMode, MatchState } from "./types.js";

/**
 * Ranked matches on the horns_elo Solana program (devnet): commit the shuffle seed before the
 * first deal, settle finishing places at the end, and record the on-chain Elo in elo_history.
 * Env: SOLANA_RPC (devnet default), SERVER_KEYPAIR (~/.config/solana/horns-elo-server.json).
 * Without a keypair, matches still run; they just aren't rated.
 */
const PROGRAM_MODE: Record<GameMode, Mode> = { "hands-up": "heads_up", "sng-4": "four", "sng-6": "six" };

function loadChain(): SolanaChain | null {
  const path = process.env.SERVER_KEYPAIR ?? `${homedir()}/.config/solana/horns-elo-server.json`;
  if (!existsSync(path)) {
    console.warn(`[solana] no server keypair at ${path}; ranked Elo is off`);
    return null;
  }
  const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  const connection = new Connection(process.env.SOLANA_RPC ?? clusterApiUrl("devnet"), "confirmed");
  console.log(`[solana] ranked Elo on ${process.env.SOLANA_RPC ?? "devnet"} as ${key.publicKey.toBase58()}`);
  return new SolanaChain(connection, key);
}

const chain = loadChain();
export const solanaReady = chain !== null;

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

async function recordElo(walletId: string, mode: GameMode, elo: number, matchId?: string) {
  if (!dbReady) return;
  await appendEloHistory(walletId, mode, elo, matchId).catch((error) =>
    console.warn("[db] elo history", (error as Error).message),
  );
}

/**
 * Before the first deal: register any new players (server pays) and commit sha256(seed).
 * Returns the on-chain match id, or null if Solana is off or unreachable (the match still runs).
 */
export async function commitRankedMatch(mode: GameMode, wallets: string[], seedHex: string): Promise<string | null> {
  if (!chain) return null;
  const programMode = PROGRAM_MODE[mode];
  try {
    const registered = await chain.ensureRegistered(wallets, programMode);
    for (const walletId of registered) await recordElo(walletId, mode, 1200); // starting point for the chart
    const id = await chain.createMatch(programMode, wallets, sha256(Buffer.from(seedHex, "hex")));
    console.log(`[solana] match ${id} committed (${mode}, ${wallets.length} players)`);
    return id.toString();
  } catch (error) {
    console.warn("[solana] commit failed; match will be unrated:", (error as Error).message);
    return null;
  }
}

/** The wallet's on-chain Elo for this mode, or null if unrated / Solana is off. */
export async function ratingFor(walletId: string, mode: GameMode): Promise<number | null> {
  if (!chain) return null;
  return chain.rating(walletId, PROGRAM_MODE[mode]).catch(() => null);
}

export type EloChange = { walletId: string; before: number; after: number };

/** After the last hand: reveal the seed, settle places on-chain, and record the new ratings. */
export async function settleRankedMatch(match: MatchState): Promise<EloChange[] | null> {
  if (!chain || !match.ranked || match.chainMatchId === null) return null;
  const programMode = PROGRAM_MODE[match.mode];
  const wallets = match.players.map((p) => p.walletId);
  const places = wallets.map((w) => match.places[w] ?? wallets.length);
  try {
    const before = await Promise.all(wallets.map((w) => chain.rating(w, programMode)));
    const standings = match.players.map((p) => ({ wallet: p.walletId, place: match.places[p.walletId], stack: p.stack }));
    await chain.settleMatch(BigInt(match.chainMatchId), programMode, wallets, places, Buffer.from(match.seed, "hex"), sha256(JSON.stringify(standings)));
    const after = await Promise.all(wallets.map((w) => chain.rating(w, programMode)));
    const changes = wallets.map((walletId, i) => ({ walletId, before: before[i] ?? 1200, after: after[i] ?? 1200 }));
    for (const c of changes) await recordElo(c.walletId, match.mode, c.after, match.id);
    console.log(`[solana] match ${match.chainMatchId} settled: ${changes.map((c) => `${c.walletId.slice(0, 4)} ${c.before}->${c.after}`).join(", ")}`);
    return changes;
  } catch (error) {
    console.warn(`[solana] settle failed for match ${match.chainMatchId}:`, (error as Error).message);
    return null;
  }
}
