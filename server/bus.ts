import { getRealtime, INBOX_CHANNEL } from "./ably.js";
import { addChat, joinQueue, leaveQueue, playAction } from "./matchmaking.js";
import { MODES, type ActionType, type GameMode } from "./types.js";

const walletRe = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;

function isWallet(value: unknown): value is string {
  return typeof value === "string" && walletRe.test(value);
}

function isMode(value: unknown): value is GameMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

function actor(message: { clientId?: string | null }, walletId: unknown) {
  return isWallet(message.clientId) && message.clientId === walletId ? message.clientId : null;
}

export async function listenInbox() {
  const realtime = getRealtime();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Ably realtime connect timeout")), 15000);
    realtime.connection.once("connected", () => {
      clearTimeout(timer);
      resolve();
    });
    realtime.connection.once("failed", (change) => {
      clearTimeout(timer);
      reject(change.reason ?? new Error("Ably realtime failed"));
    });
    if (realtime.connection.state === "connected") {
      clearTimeout(timer);
      resolve();
    }
  });

  const inbox = realtime.channels.get(INBOX_CHANNEL);
  await inbox.subscribe("join", (message) => {
    const data = (message.data ?? {}) as { walletId?: unknown; mode?: unknown };
    const walletId = actor(message, data.walletId);
    if (!walletId || !isMode(data.mode)) return;
    void joinQueue(walletId, data.mode).catch((error) =>
      console.warn("[ably] join", (error as Error).message),
    );
  });
  await inbox.subscribe("leave", (message) => {
    const data = (message.data ?? {}) as { walletId?: unknown };
    const walletId = actor(message, data.walletId);
    if (!walletId) return;
    void leaveQueue(walletId).catch((error) =>
      console.warn("[ably] leave", (error as Error).message),
    );
  });
  await inbox.subscribe("action", (message) => {
    const data = (message.data ?? {}) as {
      walletId?: unknown;
      matchId?: unknown;
      type?: unknown;
      raiseTo?: unknown;
    };
    const walletId = actor(message, data.walletId);
    if (!walletId || typeof data.matchId !== "string") return;
    if (data.type !== "fold" && data.type !== "check" && data.type !== "call" && data.type !== "raise") {
      return;
    }
    void playAction(data.matchId, walletId, {
      type: data.type as ActionType,
      raiseTo: typeof data.raiseTo === "number" ? data.raiseTo : undefined,
    }).catch((error) => console.warn("[ably] action", (error as Error).message));
  });
  await inbox.subscribe("chat", (message) => {
    const data = (message.data ?? {}) as {
      walletId?: unknown;
      matchId?: unknown;
      text?: unknown;
    };
    const walletId = actor(message, data.walletId);
    if (!walletId || typeof data.matchId !== "string" || typeof data.text !== "string") return;
    void addChat(data.matchId, walletId, data.text).catch((error) =>
      console.warn("[ably] chat", (error as Error).message),
    );
  });

  for (const mode of MODES) {
    const channel = realtime.channels.get(`queue:${mode}`);
    // Presence never queues anyone (only pressing queue does); leaving it does drop your seat.
    channel.presence.subscribe("leave", (member) => {
      const walletId = member.clientId;
      if (!isWallet(walletId)) return;
      setTimeout(() => {
        void channel.presence.get().then((members) => {
          if (members.some((seat) => seat.clientId === walletId)) return;
          void leaveQueue(walletId).catch((error) =>
            console.warn("[ably] presence leave", (error as Error).message),
          );
        });
      }, 2500);
    });
  }

  console.log("[ably] global inbox ready");
}
