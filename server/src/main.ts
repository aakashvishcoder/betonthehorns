// Runs the game server against the deployed horns_elo program.
//   node src/main.ts
// Env: PORT (8787), SOLANA_RPC (devnet), SERVER_KEYPAIR (~/.config/solana/horns-elo-server.json)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
import { startGameServer } from "./server.ts";
import { SolanaChain } from "./solana-chain.ts";

const port = Number(process.env.PORT ?? 8787);
const rpc = process.env.SOLANA_RPC ?? clusterApiUrl("devnet");
const keypairPath = process.env.SERVER_KEYPAIR ?? `${homedir()}/.config/solana/horns-elo-server.json`;
const server = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8"))));

startGameServer({
  port,
  chain: new SolanaChain(new Connection(rpc, "confirmed"), server),
  log: msg => console.log(new Date().toISOString(), msg),
});
console.log(`Game server on ws://localhost:${port} (result authority ${server.publicKey.toBase58()}, ${rpc})`);
