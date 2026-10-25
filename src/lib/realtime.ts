import * as Ably from "ably";
import { api, type QueueSnapshot } from "@/lib/api";
import type { GameModeId } from "@/lib/game-modes";

const INBOX = "inbox";
const subscribeKey = import.meta.env.VITE_ABLY_SUBSCRIBE_KEY as string | undefined;

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
    clientId: walletId,
    authCallback: (_params, callback) => {
      void api
        .ablyToken(walletId)
        .then((token) => callback(null, token as Ably.TokenRequest))
        .catch((error: Error) => {
          if (subscribeKey) {
            callback(null, subscribeKey);
            return;
          }
          callback(error.message, null);
        });
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

export function subscribeChannel(
  walletId: string,
  name: string,
  event: string,
  onMessage: (data: unknown) => void,
  rewind = 0,
) {
  const channel = getRealtime(walletId).channels.get(
    name,
    rewind > 0 ? { params: { rewind: String(rewind) } } : {},
  );
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
  const channel = getRealtime(walletId).channels.get(`queue:${mode}`);
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
  const channel = getRealtime(walletId).channels.get(`queue:${mode}`);
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
  channel.presence.subscribe(fromPresence);
  fromPresence();
  const stopSnap = subscribeChannel(
    walletId,
    `queue:${mode}`,
    "waiting",
    (data) => {
      onQueue(data as QueueSnapshot);
    },
    1,
  );
  return () => {
    channel.presence.unsubscribe(fromPresence);
    stopSnap();
  };
}
