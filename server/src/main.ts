// Runs the game server against the deployed horns_elo program, plus the AI coach endpoint.
//   npm start
// Env (server/.env is loaded automatically): PORT (8787), SOLANA_RPC (devnet),
// SERVER_KEYPAIR (~/.config/solana/horns-elo-server.json), MODEL_API_KEY (Muse coach),
// SNOWFLAKE_ACCOUNT + SNOWFLAKE_PAT (AI practice opponents and style data),
// SERPAPI_KEY (news ticker + coach web search)
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
import { snowflakeAuthFromEnv } from "./ai/cortex.ts";
import { MemoryStyleStore, SnowflakeStyleStore } from "./ai/style-store.ts";
import { coachHandler } from "./coach.ts";
import { NewsFeed, newsHandler } from "./news.ts";
import { CoachSearch } from "./serpapi.ts";
import { startGameServer } from "./server.ts";
import { SolanaChain } from "./solana-chain.ts";

const port = Number(process.env.PORT ?? 8787);
const rpc = process.env.SOLANA_RPC ?? clusterApiUrl("devnet");
const keypairPath = process.env.SERVER_KEYPAIR ?? `${homedir()}/.config/solana/horns-elo-server.json`;
const server = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8"))));
const log = (msg: string) => console.log(new Date().toISOString(), msg);

const serpKey = process.env.SERPAPI_KEY;
const coach = coachHandler({
  apiKey: process.env.MODEL_API_KEY,
  inRankedGame: w => game.inRankedGame(w),
  search: serpKey ? new CoachSearch(serpKey) : undefined,
  log,
});
const news = newsHandler(new NewsFeed(serpKey, { log }));
const http = createServer((req, res) => {
  if (req.url === "/api/coach") return void coach(req, res);
  if (req.url === "/api/news") return void news(req, res);
  res.writeHead(404).end();
});
const snowflake = snowflakeAuthFromEnv();
const game = startGameServer({
  server: http,
  chain: new SolanaChain(new Connection(rpc, "confirmed"), server),
  styleStore: snowflake ? new SnowflakeStyleStore(snowflake) : new MemoryStyleStore(),
  ai: { auth: snowflake },
  log,
});
http.listen(port);
console.log(`Game server on ws://localhost:${port} (result authority ${server.publicKey.toBase58()}, ${rpc})`);
console.log(`Coach: ${process.env.MODEL_API_KEY ? "on" : "off (set MODEL_API_KEY in server/.env)"}`);
console.log(`News + coach search: ${serpKey ? "on (SerpApi)" : "off (set SERPAPI_KEY in server/.env)"}`);
console.log(`AI opponents: ${snowflake ? "Snowflake Cortex + style data" : "rules only (set SNOWFLAKE_ACCOUNT and SNOWFLAKE_PAT in server/.env)"}`);
