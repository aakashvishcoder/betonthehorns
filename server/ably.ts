import "dotenv/config";
import Ably from "ably";
import type { GameMode } from "./types.js";

export const INBOX_CHANNEL = "inbox";

let rest: Ably.Rest | null = null;
let realtime: Ably.Realtime | null = null;

function rootKey() {
  const key = process.env.ABLY_ROOT_KEY;
  if (!key) {
    throw new Error("ABLY_ROOT_KEY is missing. Add it to .env");
  }
  return key;
}

export function getRest() {
  if (!rest) rest = new Ably.Rest({ key: rootKey() });
  return rest;
}

export function getRealtime() {
  if (!realtime) {
    realtime = new Ably.Realtime({ key: rootKey() });
  }
  return realtime;
}

export async function publish(channel: string, name: string, data: unknown) {
  try {
    await getRest().channels.get(channel).publish(name, data);
  } catch (error) {
    console.warn("[ably]", channel, name, (error as Error).message);
  }
}

export async function listQueuePresence(mode: GameMode) {
  try {
    const client = getRealtime();
    if (client.connection.state !== "connected") return [];
    const members = await client.channels.get(`queue:${mode}`).presence.get();
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
  return getRest().auth.createTokenRequest({
    clientId: walletId,
    capability: {
      [`queue:*`]: ["subscribe", "presence"],
      [`table:*`]: ["subscribe"],
      [`wallet:${walletId}`]: ["subscribe"],
      [INBOX_CHANNEL]: ["publish", "subscribe"],
    },
  });
}
