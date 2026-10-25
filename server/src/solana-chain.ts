import {
  type Connection,
  type Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import type { Chain } from "./chain.ts";
import type { Mode } from "./matchmaker.ts";

export const PROGRAM_ID = new PublicKey("E4WuDUxqymTCF7rqQz4a4ZmVhWuQJe9Pbrmy7uia5Bbo");

// Anchor discriminators, from anchor/target/idl/horns_elo.json. They change only if an instruction is renamed.
const IX = {
  registerPlayer: [242, 146, 194, 234, 234, 145, 228, 42],
  sponsorPlayer: [80, 91, 120, 209, 83, 206, 122, 180],
  createMatch: [107, 2, 184, 145, 70, 142, 17, 165],
  settleMatch: [71, 124, 117, 96, 191, 217, 116, 24],
};
const ACCOUNT = {
  config: [155, 12, 170, 224, 30, 250, 204, 130],
  playerRating: [130, 129, 113, 19, 189, 85, 231, 21],
};
const MODE_INDEX: Record<Mode, number> = { heads_up: 0, four: 1, six: 2 };

const pda = (...seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const configAddress = () => pda(Buffer.from("config"));
export const ratingAddress = (wallet: PublicKey, mode: Mode) => pda(Buffer.from("player"), wallet.toBuffer(), Buffer.from([MODE_INDEX[mode]]));
const matchAddress = (id: bigint) => {
  const le = Buffer.alloc(8);
  le.writeBigUInt64LE(id);
  return pda(Buffer.from("match"), le);
};

// Minimal Borsh: u8 enum, Vec<T> = u32 length + items, fixed arrays as raw bytes.
const vecOf = (items: Buffer[]) => {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(items.length);
  return Buffer.concat([len, ...items]);
};

const hasDiscriminator = (data: Buffer, d: number[]) => data.subarray(0, 8).equals(Buffer.from(d));

/** A player signs this themselves (their wallet pays the rent). Used by bots and tests. */
export function registerPlayerIx(wallet: PublicKey, mode: Mode) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: ratingAddress(wallet, mode), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([...IX.registerPlayer, MODE_INDEX[mode]]),
  });
}

export type RatingAccount = { rating: number; games: number; wins: number };

export async function readRating(connection: Connection, wallet: PublicKey, mode: Mode): Promise<RatingAccount | null> {
  const info = await connection.getAccountInfo(ratingAddress(wallet, mode));
  if (!info || !hasDiscriminator(info.data, ACCOUNT.playerRating)) return null;
  // 8 discriminator + 32 wallet + 1 mode, then u32 rating, games, wins.
  return { rating: info.data.readUInt32LE(41), games: info.data.readUInt32LE(45), wins: info.data.readUInt32LE(49) };
}

/** Talks to the deployed horns_elo program as the game server (result authority). */
export class SolanaChain implements Chain {
  private readonly connection: Connection;
  private readonly server: Keypair;
  /** create_match reads match_count, so matches are opened one at a time. */
  private opening: Promise<unknown> = Promise.resolve();

  constructor(connection: Connection, server: Keypair) {
    this.connection = connection;
    this.server = server;
  }

  /**
   * Creates rating accounts (paid by the server) for any of these wallets that don't have one
   * for this mode yet. Returns the wallets that were newly registered.
   */
  async ensureRegistered(wallets: string[], mode: Mode): Promise<string[]> {
    const missing: string[] = [];
    for (const w of wallets) if ((await this.rating(w, mode)) === null) missing.push(w);
    if (!missing.length) return [];
    const tx = new Transaction();
    for (const w of missing) {
      const wallet = new PublicKey(w);
      tx.add(
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: this.server.publicKey, isSigner: true, isWritable: true },
            { pubkey: configAddress(), isSigner: false, isWritable: false },
            { pubkey: ratingAddress(wallet, mode), isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: Buffer.concat([Buffer.from(IX.sponsorPlayer), wallet.toBuffer(), Buffer.from([MODE_INDEX[mode]])]),
        }),
      );
    }
    await sendAndConfirmTransaction(this.connection, tx, [this.server], { commitment: "confirmed" });
    return missing;
  }

  async rating(wallet: string, mode: Mode) {
    return (await readRating(this.connection, new PublicKey(wallet), mode))?.rating ?? null;
  }

  createMatch(mode: Mode, players: string[], seedCommitment: Uint8Array) {
    const run = this.opening.then(async () => {
      const config = await this.connection.getAccountInfo(configAddress());
      if (!config || !hasDiscriminator(config.data, ACCOUNT.config)) throw new Error("program config not initialized");
      // 8 discriminator + 32 admin + 32 result_authority, then u64 match_count.
      const id = config.data.readBigUInt64LE(72);
      const data = Buffer.concat([
        Buffer.from(IX.createMatch),
        Buffer.from([MODE_INDEX[mode]]),
        vecOf(players.map(p => new PublicKey(p).toBuffer())),
        Buffer.from(seedCommitment),
      ]);
      await this.send(
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: this.server.publicKey, isSigner: true, isWritable: true },
            { pubkey: configAddress(), isSigner: false, isWritable: true },
            { pubkey: matchAddress(id), isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data,
        }),
      );
      return id;
    });
    this.opening = run.catch(() => {});
    return run;
  }

  async settleMatch(matchId: bigint, mode: Mode, players: string[], places: number[], seed: Uint8Array, standingsHash: Uint8Array) {
    const data = Buffer.concat([
      Buffer.from(IX.settleMatch),
      vecOf(places.map(p => Buffer.from([p]))),
      Buffer.from(seed),
      Buffer.from(standingsHash),
    ]);
    await this.send(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: this.server.publicKey, isSigner: true, isWritable: false },
          { pubkey: configAddress(), isSigner: false, isWritable: false },
          { pubkey: matchAddress(matchId), isSigner: false, isWritable: true },
          ...players.map(p => ({ pubkey: ratingAddress(new PublicKey(p), mode), isSigner: false, isWritable: true })),
        ],
        data,
      }),
    );
  }

  private send(ix: TransactionInstruction) {
    return sendAndConfirmTransaction(this.connection, new Transaction().add(ix), [this.server], { commitment: "confirmed" });
  }
}
