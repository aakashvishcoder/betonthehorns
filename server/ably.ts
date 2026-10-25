import "dotenv/config";
import Ably from "ably";

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
