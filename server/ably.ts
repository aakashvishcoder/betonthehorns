import "dotenv/config";
import Ably from "ably";

const rootKey = process.env.ABLY_ROOT_KEY;
if (!rootKey) {
  throw new Error("ABLY_ROOT_KEY is missing. Add it to .env");
}

export const ably = new Ably.Rest({ key: rootKey });

export async function publish(channel: string, name: string, data: unknown) {
  await ably.channels.get(channel).publish(name, data);
}

export async function tokenRequest(walletId: string) {
  return ably.auth.createTokenRequest({
    clientId: walletId,
    capability: {
      [`queue:*`]: ["subscribe"],
      [`table:*`]: ["subscribe"],
      [`wallet:${walletId}`]: ["subscribe"],
    },
  });
}
