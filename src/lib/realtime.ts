import * as Ably from "ably";
import { api } from "@/lib/api";

let client: Ably.Realtime | null = null;
let boundWallet: string | null = null;

export function getRealtime(walletId: string) {
  if (client && boundWallet === walletId) return client;
  if (client) {
    client.close();
    client = null;
  }
  boundWallet = walletId;
  client = new Ably.Realtime({
    authCallback: (_params, callback) => {
      void api
        .ablyToken(walletId)
        .then((token) => callback(null, token as Ably.TokenRequest))
        .catch((error: Error) => callback(error.message, null));
    },
  });
  return client;
}

export function subscribeChannel(
  walletId: string,
  name: string,
  event: string,
  onMessage: (data: unknown) => void,
) {
  const channel = getRealtime(walletId).channels.get(name);
  const listener = (message: Ably.Message) => {
    onMessage(message.data);
  };
  void channel.subscribe(event, listener);
  return () => {
    channel.unsubscribe(event, listener);
  };
}
