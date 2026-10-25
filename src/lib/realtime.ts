import * as Ably from "ably";
import { api, type QueueSnapshot } from "@/lib/api";
import type { GameModeId } from "@/lib/game-modes";

/** Must match CHANNEL_VERSION in server/ably.ts: older deployments use the bare names. */
const CHANNEL_VERSION = "v2:";
const INBOX = `${CHANNEL_VERSION}inbox`;

let client: Ably.Realtime | null = null;
let boundWallet: string | null = null;

function asTokenRequest(value: unknown): Ably.TokenRequest | null {
  if (!value || typeof value !== "object") return null;
  const token = value as Ably.TokenRequest;
  if (!token.keyName || !token.mac || !token.nonce) return null;
  return token;
}

export function getRealtime(walletId: string) {
  if (client && boundWallet === walletId) return client;
  if (client) {
    client.close();
    client = null;
  }
  boundWallet = walletId;
  client = new Ably.Realtime({
    clientId: walletId,
    authCallback: (_params, callback) => {
      void api
        .ablyToken(walletId)
        .then((token) => {
          const request = asTokenRequest(token);
          if (!request) {
            callback("Ably token was missing from the API", null);
            return;
          }
          callback(null, request);
        })
        .catch((error: Error) => callback(error.message, null));
    },
  });
  return client;
}

export function watchConnection(
  walletId: string,
  onState: (state: string, reason?: string) => void,
) {
  const realtime = getRealtime(walletId);
  const listener = (change: Ably.ConnectionStateChange) => {
    onState(change.current, change.reason?.message);
  };
  realtime.connection.on(listener);
  onState(realtime.connection.state, realtime.connection.errorReason?.message);
  return () => {
    realtime.connection.off(listener);
  };
}

function channelOf(walletId: string, name: string) {
  return getRealtime(walletId).channels.get(`${CHANNEL_VERSION}${name}`);
}

export function subscribeChannel(
  walletId: string,
  name: string,
  event: string,
  onMessage: (data: unknown) => void,
) {
  const channel = channelOf(walletId, name);
  const listener = (message: Ably.Message) => {
    onMessage(message.data);
  };
  void channel.subscribe(event, listener).catch((error: Error) => {
    console.warn("[ably] subscribe", name, error.message);
  });
  return () => {
    channel.unsubscribe(event, listener);
  };
}

export async function sendInbox(
  walletId: string,
  event: "join" | "leave" | "action" | "chat",
  data: Record<string, unknown>,
) {
  await getRealtime(walletId).channels.get(INBOX).publish(event, { ...data, walletId });
}

export function enterQueuePresence(walletId: string, mode: GameModeId) {
  const channel = channelOf(walletId, `queue:${mode}`);
  void channel.presence.enter({ walletId, mode }).catch((error: Error) => {
    console.warn("[ably] presence", error.message);
  });
  return () => {
    void channel.presence.leave().catch(() => undefined);
  };
}

export function watchGlobalQueue(
  walletId: string,
  mode: GameModeId,
  seats: number,
  onQueue: (queue: QueueSnapshot) => void,
) {
  const channel = channelOf(walletId, `queue:${mode}`);
  const fromPresence = () => {
    void channel.presence.get().then((members) => {
      const wallets = [
        ...new Set(
          members
            .map((member) => member.clientId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      onQueue({ mode, seats, count: wallets.length, wallets });
    });
  };
  // Presence is the one source for the counter: every browser sees the same members. (The
  // server's own "waiting" broadcasts could disagree, e.g. an instance not connected to Ably
  // reporting 0, which made the counter flip between 0 and 1.)
  channel.presence.subscribe(fromPresence);
  fromPresence();
  return () => {
    channel.presence.unsubscribe(fromPresence);
  };
}
