import "dotenv/config";
import Ably from "ably";
import type { GameMode } from "./types.js";

const rootKey = process.env.ABLY_ROOT_KEY;
if (!rootKey) {
  throw new Error("ABLY_ROOT_KEY is missing. Add it to .env");
}

export const INBOX_CHANNEL = "inbox";

export const ably = new Ably.Rest({ key: rootKey });

let realtime: Ably.Realtime | null = null;

export function getRealtime() {
  if (!realtime) {
    realtime = new Ably.Realtime({ key: rootKey });
  }
  return realtime;
}

export async function publish(channel: string, name: string, data: unknown) {
  try {
    await ably.channels.get(channel).publish(name, data);
  } catch (error) {
    console.warn("[ably]", channel, name, (error as Error).message);
  }
}

export async function listQueuePresence(mode: GameMode) {
  try {
    const realtime = getRealtime();
    if (realtime.connection.state !== "connected") return [];
    const members = await realtime.channels.get(`queue:${mode}`).presence.get();
    const seats = new Map<string, number>();
    for (const member of members) {
      if (!member.clientId) continue;
      const at = typeof member.timestamp === "number" ? member.timestamp : Date.now();
      if (!seats.has(member.clientId)) seats.set(member.clientId, at);
    }
    return [...seats.entries()]
      .map(([walletId, joinedAt]) => ({ walletId, joinedAt }))
      .sort((left, right) => left.joinedAt - right.joinedAt);
  } catch (error) {
    console.warn("[ably] presence", mode, (error as Error).message);
    return [];
  }
}

export async function tokenRequest(walletId: string) {
  return ably.auth.createTokenRequest({
    clientId: walletId,
    capability: {
      [`queue:*`]: ["subscribe", "presence"],
      [`table:*`]: ["subscribe"],
      [`wallet:${walletId}`]: ["subscribe"],
      [INBOX_CHANNEL]: ["publish", "subscribe"],
    },
  });
}
