import "dotenv/config";
import Ably from "ably";
import type { GameMode } from "./types.js";

/**
 * Every Ably channel name carries this version prefix. Older deployments that still share the
 * database and Ably app use the bare names, so they can't hear our queue/inbox events or push
 * their own games onto our players (which created duplicate games without history or Elo).
 * Bump it if a future change must not interoperate with running older code.
 */
export const CHANNEL_VERSION = "v2:";
export const ch = (name: string) => `${CHANNEL_VERSION}${name}`;
export const INBOX_CHANNEL = ch("inbox");

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
    await getRest().channels.get(ch(channel)).publish(name, data);
  } catch (error) {
    console.warn("[ably]", channel, name, (error as Error).message);
  }
}

export async function listQueuePresence(mode: GameMode) {
  try {
    const client = getRealtime();
    if (client.connection.state !== "connected") return [];
    const members = await client.channels.get(ch(`queue:${mode}`)).presence.get();
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
      [ch("queue:*")]: ["subscribe", "presence"],
      [ch("table:*")]: ["subscribe"],
      [ch(`wallet:${walletId}`)]: ["subscribe"],
      [INBOX_CHANNEL]: ["publish", "subscribe"],
    },
  });
}
