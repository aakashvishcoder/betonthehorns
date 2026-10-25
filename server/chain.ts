import { createHash } from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { modeIndex } from "./elo.js";
import type { ChainTx, GameMode } from "./types.js";

const DEFAULT_ELO_PROGRAM = "9KXCrZkohvdxYUvKU9kusUcBCdj1JB1NFUoYgFbdnWS2";
const DEFAULT_ACHIEVEMENT_PROGRAM = "5edqME6uP35tWd8Wt47UMEND9EzwnTPWcqY7CyGk554F";

type ChainPlayer = {
  walletId: string;
  elo: number;
  payout: number;
  hands: number;
  won: boolean;
};

function discriminator(name: string) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function matchHash(matchId: string) {
  return createHash("sha256").update(matchId).digest();
}

function bytes32(hex: string) {
  const buffer = Buffer.from(hex, "hex");
  if (buffer.length !== 32) throw new Error("Expected 32 bytes");
  return buffer;
}

function authority() {
  const secret = process.env.SOLANA_AUTHORITY_SECRET?.trim();
  if (!secret?.startsWith("[")) return null;
  const parsed = JSON.parse(secret) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function connection() {
  return new Connection(
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    "confirmed",
  );
}

function eloProgram() {
  return new PublicKey(process.env.ELO_PROGRAM_ID || DEFAULT_ELO_PROGRAM);
}

function achievementProgram() {
  return new PublicKey(
    process.env.ACHIEVEMENT_PROGRAM_ID || DEFAULT_ACHIEVEMENT_PROGRAM,
  );
}

function ratingAddress(player: PublicKey, mode: number) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rating"), player.toBuffer(), Buffer.from([mode])],
    eloProgram(),
  )[0];
}

function escrowAddress(hash: Buffer) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), hash],
    eloProgram(),
  )[0];
}

function recordAddress(player: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("record"), player.toBuffer()],
    achievementProgram(),
  )[0];
}

async function send(instructions: TransactionInstruction[]) {
  const signer = authority();
  if (!signer || instructions.length === 0) return null;
  const tx = new Transaction().add(...instructions);
  return sendAndConfirmTransaction(connection(), tx, [signer]);
}

export async function lockMatch(input: {
  matchId: string;
  mode: GameMode;
  commitHash: string;
  wallets: string[];
  stakes: number[];
}): Promise<ChainTx[]> {
  const signer = authority();
  if (!signer) return [];
  try {
    const rpc = connection();
    const mode = modeIndex(input.mode);
    const hash = matchHash(input.matchId);
    const commit = bytes32(input.commitHash);
    const instructions: TransactionInstruction[] = [];

    for (const walletId of input.wallets) {
      const player = new PublicKey(walletId);
      const rating = ratingAddress(player, mode);
      if (await rpc.getAccountInfo(rating)) continue;
      instructions.push(
        new TransactionInstruction({
          programId: eloProgram(),
          keys: [
            { pubkey: rating, isSigner: false, isWritable: true },
            { pubkey: player, isSigner: false, isWritable: false },
            { pubkey: signer.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: Buffer.concat([discriminator("initialize_rating"), Buffer.from([mode])]),
        }),
      );
    }

    const escrow = escrowAddress(hash);
    if (!(await rpc.getAccountInfo(escrow))) {
      const stakeData = Buffer.alloc(4 + input.stakes.length * 4);
      stakeData.writeUInt32LE(input.stakes.length, 0);
      input.stakes.forEach((stake, index) => {
        stakeData.writeUInt32LE(stake, 4 + index * 4);
      });
      const body = Buffer.concat([
        hash,
        Buffer.from([mode]),
        commit,
        stakeData,
      ]);
      instructions.push(
        new TransactionInstruction({
          programId: eloProgram(),
          keys: [
            { pubkey: escrow, isSigner: false, isWritable: true },
            { pubkey: signer.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ...input.wallets.map((walletId) => ({
              pubkey: ratingAddress(new PublicKey(walletId), mode),
              isSigner: false,
              isWritable: true,
            })),
          ],
          data: Buffer.concat([discriminator("open_escrow"), body]),
        }),
      );
    }

    const signature = await send(instructions);
    return signature ? [{ label: "ELO locked", signature }] : [];
  } catch (error) {
    console.warn("[chain] lock", (error as Error).message);
    return [];
  }
}

export async function revealMatch(input: {
  matchId: string;
  mode: GameMode;
  seed: string;
  players: ChainPlayer[];
}): Promise<ChainTx[]> {
  const signer = authority();
  if (!signer) return [];
  try {
    const mode = modeIndex(input.mode);
    const hash = matchHash(input.matchId);
    const seed = bytes32(input.seed);
    const escrow = escrowAddress(hash);
    const payouts = Buffer.alloc(4 + input.players.length * 4);
    payouts.writeUInt32LE(input.players.length, 0);
    input.players.forEach((player, index) => {
      payouts.writeUInt32LE(player.payout, 4 + index * 4);
    });

    const txs: ChainTx[] = [];
    const settled = await send([
      new TransactionInstruction({
        programId: eloProgram(),
        keys: [
          { pubkey: escrow, isSigner: false, isWritable: true },
          { pubkey: signer.publicKey, isSigner: true, isWritable: false },
          ...input.players.map((player) => ({
            pubkey: ratingAddress(new PublicKey(player.walletId), mode),
            isSigner: false,
            isWritable: true,
          })),
        ],
        data: Buffer.concat([discriminator("settle"), seed, payouts]),
      }),
    ]);
    if (settled) txs.push({ label: "ELO settled", signature: settled });

    const syncs = input.players.map((player) => {
      const wallet = new PublicKey(player.walletId);
      const body = Buffer.alloc(1 + 4 + 4 + 1);
      body.writeUInt8(mode, 0);
      body.writeUInt32LE(player.elo, 1);
      body.writeUInt32LE(player.hands, 5);
      body.writeUInt8(player.won ? 1 : 0, 9);
      return new TransactionInstruction({
        programId: achievementProgram(),
        keys: [
          { pubkey: recordAddress(wallet), isSigner: false, isWritable: true },
          { pubkey: wallet, isSigner: false, isWritable: false },
          { pubkey: signer.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([discriminator("sync"), body]),
      });
    });
    const synced = await send(syncs);
    if (synced) txs.push({ label: "Achievement sync", signature: synced });
    return txs;
  } catch (error) {
    console.warn("[chain] reveal", (error as Error).message);
    return [];
  }
}
