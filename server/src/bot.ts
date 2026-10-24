import WebSocket from "ws";
import type { Legal } from "./game.ts";
import type { Mode } from "./matchmaker.ts";
import { fakeWallet } from "./wallet.ts";

/** A rough strategy: mostly call/check, sometimes raise, folds some big bets, shoves short stacks. */
function choose(legal: Legal, stack: number, bigBlind: number) {
  const roll = Math.random();
  if (legal.canRaise && stack <= 8 * bigBlind && roll < 0.6) return { type: "raise", to: legal.maxRaiseTo };
  if (!legal.canCheck && legal.toCall > stack / 3 && roll < 0.45) return { type: "fold" };
  if (legal.canRaise && roll < 0.2) {
    const to = Math.min(legal.maxRaiseTo, legal.minRaiseTo + Math.floor(Math.random() * 3) * bigBlind);
    return { type: "raise", to };
  }
  if (!legal.canCheck && roll > 0.9) return { type: "fold" };
  return legal.canCheck ? { type: "check" } : { type: "call" };
}

/**
 * Connects like a real player: fake wallet, signed login, queue, then plays every turn.
 * Resolves with the "finished" message when its game ends.
 */
export function runBot(url: string, mode: Mode, thinkMs = 700) {
  const wallet = fakeWallet();
  const finished = new Promise<{ places: Record<string, number> }>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.on("error", reject);
    socket.on("message", data => {
      const m = JSON.parse(String(data));
      if (m.type === "challenge") socket.send(JSON.stringify({ type: "login", wallet: wallet.address, signature: wallet.signLogin(m.nonce) }));
      if (m.type === "welcome") socket.send(JSON.stringify({ type: "queue", mode }));
      if (m.type === "table" && m.view.toAct === wallet.address && m.view.legal) {
        const me = m.view.seats.find((s: { id: string }) => s.id === wallet.address);
        const action = choose(m.view.legal, me.stack, m.view.blinds[1]);
        setTimeout(() => socket.send(JSON.stringify({ type: "action", action })), thinkMs * (0.5 + Math.random()));
      }
      if (m.type === "finished") {
        socket.close();
        resolve(m);
      }
    });
  });
  return { wallet: wallet.address, finished };
}
