// Offline prototype of the full game flow, with no Solana anywhere:
//   npm run prototype        then open http://localhost:8080 in 2, 4 or 6 tabs
// Same game server as production; the horns_elo program is replaced by MemoryChain
// (auto-registers wallets at 1200, checks the seed reveal, applies the same Elo).
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { runBot } from "./bot.ts";
import { MemoryChain } from "./chain.ts";
import { MODES, type Mode } from "./matchmaker.ts";
import { startGameServer } from "./server.ts";

export function startPrototype(port: number, options: { botThinkMs?: number; log?: (msg: string) => void } = {}) {
  const chain = new MemoryChain({ autoRegister: true });
  const page = new URL("../prototype/index.html", import.meta.url);

  const json = (res: ServerResponse, body: unknown, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  };
  const body = async (req: IncomingMessage) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : {};
  };

  const http = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/") {
        return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(await readFile(page));
      }
      if (req.method === "GET" && req.url === "/api/state") {
        return json(res, {
          ratings: [...chain.records.values()],
          queues: Object.fromEntries(Object.keys(MODES).map(m => [m, game.matchmaker.waiting(m as Mode)])),
          tables: [...game.tables.values()].map(t => ({ id: t.id, mode: t.mode, players: t.players, hand: t.game.handNo })),
          matches: chain.matches.map(m => ({ id: m.id.toString(), mode: m.mode, players: m.players, places: m.settled?.places ?? null })),
        });
      }
      if (req.method === "POST" && req.url === "/api/bots") {
        const { mode, count } = await body(req);
        if (!(mode in MODES) || !(count >= 1 && count <= 5)) return json(res, { error: "mode and count (1-5) required" }, 400);
        const bots = Array.from({ length: count }, () => runBot(`ws://localhost:${port}`, mode, options.botThinkMs));
        for (const b of bots) b.finished.catch(e => options.log?.(`bot error: ${e.message}`));
        return json(res, { bots: bots.map(b => b.wallet) });
      }
      json(res, { error: "not found" }, 404);
    } catch (e) {
      json(res, { error: (e as Error).message }, 500);
    }
  });

  const game = startGameServer({ server: http, chain, log: options.log });
  http.listen(port);
  return {
    chain,
    game,
    close: async () => {
      await game.close();
      await new Promise(resolve => http.close(resolve));
    },
  };
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8080);
  startPrototype(port, { log: msg => console.log(new Date().toISOString(), msg) });
  console.log(`Prototype running: open http://localhost:${port} in a few tabs (no Solana; wallets are throwaway keys).`);
}
