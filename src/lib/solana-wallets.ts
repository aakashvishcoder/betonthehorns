import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

const SOLANA_CHAIN = "solana:";

type ConnectFeature = {
  connect: (input?: { silent?: boolean }) => Promise<{
    accounts: readonly WalletAccount[];
  }>;
};

type DisconnectFeature = {
  disconnect: () => Promise<void>;
};

type ChangeListener = (properties: {
  accounts?: readonly WalletAccount[];
}) => void;

type EventsFeature = {
  on: (event: "change", listener: ChangeListener) => () => void;
};

type SignMessageFeature = {
  signMessage: (
    ...inputs: { account: WalletAccount; message: Uint8Array }[]
  ) => Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]>;
};

type LegacyProvider = {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  isGlow?: boolean;
  publicKey?: { toBase58?: () => string; toString: () => string } | null;
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{
    publicKey?: { toBase58?: () => string; toString: () => string } | null;
  }>;
  disconnect?: () => Promise<void>;
  signMessage?: (message: Uint8Array, display?: string) => Promise<{ signature: Uint8Array } | Uint8Array>;
  on?: (event: string, handler: (publicKey: unknown) => void) => void;
  removeListener?: (event: string, handler: (publicKey: unknown) => void) => void;
};

const FALLBACK_ICON =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzZmMjA4OCIvPjwvc3ZnPg==" as Wallet["icon"];

const registeredLegacyNames = new Set<string>();

declare global {
  interface Window {
    solana?: LegacyProvider;
    phantom?: { solana?: LegacyProvider };
    solflare?: LegacyProvider;
    backpack?: LegacyProvider;
    glowSolana?: LegacyProvider;
  }
}

function isSolanaWallet(wallet: Wallet) {
  return wallet.chains.some((chain) => chain.startsWith(SOLANA_CHAIN));
}

function feature<T>(wallet: Wallet, name: `${string}:${string}`): T | null {
  const value = wallet.features[name];
  if (!value || typeof value !== "object") return null;
  return value as T;
}

function solanaAccount(accounts: readonly WalletAccount[]) {
  return (
    accounts.find((account) =>
      account.chains.some((chain) => chain.startsWith(SOLANA_CHAIN)),
    ) ??
    accounts[0] ??
    null
  );
}

function readAddress(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const key = value as { toBase58?: () => string; toString?: () => string };
  if (typeof key.toBase58 === "function") return key.toBase58();
  if (typeof key.toString === "function") {
    const text = key.toString();
    return text && text !== "[object Object]" ? text : null;
  }
  return null;
}

function accountFromAddress(address: string): WalletAccount {
  return {
    address,
    publicKey: new Uint8Array(32),
    chains: ["solana:mainnet", "solana:devnet"],
    features: [],
  };
}

function legacyName(provider: LegacyProvider) {
  if (provider.isPhantom) return "Phantom";
  if (provider.isSolflare) return "Solflare";
  if (provider.isBackpack) return "Backpack";
  if (provider.isGlow) return "Glow";
  return "Solana";
}

function legacyProviders() {
  const candidates = [
    window.phantom?.solana,
    window.solflare,
    window.backpack,
    window.glowSolana,
    window.solana,
  ];
  const unique: LegacyProvider[] = [];
  for (const provider of candidates) {
    if (!provider || typeof provider.connect !== "function") continue;
    if (unique.includes(provider)) continue;
    unique.push(provider);
  }
  return unique;
}

function createLegacyWallet(provider: LegacyProvider, name: string): Wallet {
  const listeners = new Set<ChangeListener>();

  const emit = (address: string | null) => {
    const accounts = address ? [accountFromAddress(address)] : [];
    for (const listener of listeners) listener({ accounts });
  };

  const onAccountChanged = (publicKey: unknown) => emit(readAddress(publicKey));
  provider.on?.("accountChanged", onAccountChanged);

  return {
    version: "1.0.0",
    name,
    icon: FALLBACK_ICON,
    chains: ["solana:mainnet", "solana:devnet"],
    accounts: [],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async (input?: { silent?: boolean }) => {
          const result = await provider.connect(
            input?.silent ? { onlyIfTrusted: true } : undefined,
          );
          const address =
            readAddress(result?.publicKey) ?? readAddress(provider.publicKey);
          return { accounts: address ? [accountFromAddress(address)] : [] };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          await provider.disconnect?.();
          emit(null);
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (event: "change", listener: ChangeListener) => {
          if (event !== "change") return () => {};
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      ...(provider.signMessage
        ? {
            "solana:signMessage": {
              version: "1.0.0",
              signMessage: async (...inputs: { account: WalletAccount; message: Uint8Array }[]) =>
                Promise.all(
                  inputs.map(async ({ message }) => {
                    const result = await provider.signMessage!(message, "utf8");
                    const signature = result instanceof Uint8Array ? result : result.signature;
                    return { signedMessage: message, signature };
                  }),
                ),
            } satisfies SignMessageFeature & { version: string },
          }
        : {}),
    },
  };
}

/** Asks the wallet to sign a plain-text message (free; no transaction). Returns base64. */
export async function signTextMessage(wallet: Wallet, account: WalletAccount, text: string) {
  const sign = feature<SignMessageFeature>(wallet, "solana:signMessage");
  if (!sign) throw new Error(`${wallet.name} can't sign messages.`);
  const [result] = await sign.signMessage({ account, message: new TextEncoder().encode(text) });
  if (!result) throw new Error("The wallet returned no signature.");
  return btoa(String.fromCharCode(...result.signature));
}

/** Wallet Standard wallets, plus older injected providers that never registered. */
export function listSolanaWallets(): Wallet[] {
  const existingNames = new Set(
    getWallets()
      .get()
      .filter(isSolanaWallet)
      .map((wallet) => wallet.name.toLowerCase()),
  );

  for (const provider of legacyProviders()) {
    const name = legacyName(provider);
    const key = name.toLowerCase();
    if (existingNames.has(key) || registeredLegacyNames.has(key)) continue;
    getWallets().register(createLegacyWallet(provider, name));
    registeredLegacyNames.add(key);
    existingNames.add(key);
  }

  const byName = new Map<string, Wallet>();
  for (const wallet of getWallets().get()) {
    if (!isSolanaWallet(wallet) || byName.has(wallet.name)) continue;
    byName.set(wallet.name, wallet);
  }
  return [...byName.values()];
}

export function subscribeSolanaWallets(onChange: () => void) {
  const wallets = getWallets();
  const stopRegister = wallets.on("register", onChange);
  const stopUnregister = wallets.on("unregister", onChange);
  return () => {
    stopRegister();
    stopUnregister();
  };
}

export function waitForSolanaWallets(timeoutMs: number) {
  const existing = listSolanaWallets();
  if (existing.length > 0) return Promise.resolve(existing);
  return new Promise<Wallet[]>((resolve) => {
    window.setTimeout(() => resolve(listSolanaWallets()), timeoutMs);
  });
}

export async function connectSolanaWallet(wallet: Wallet, silent = false) {
  const connect = feature<ConnectFeature>(wallet, "standard:connect");
  if (!connect) throw new Error(`${wallet.name} cannot connect.`);
  const { accounts } = await connect.connect(silent ? { silent: true } : undefined);
  return solanaAccount(accounts);
}

export async function disconnectSolanaWallet(wallet: Wallet) {
  const disconnect = feature<DisconnectFeature>(wallet, "standard:disconnect");
  await disconnect?.disconnect();
}

export function watchSolanaAccounts(
  wallet: Wallet,
  onAccounts: (accounts: readonly WalletAccount[]) => void,
) {
  const events = feature<EventsFeature>(wallet, "standard:events");
  if (!events) return () => {};
  return events.on("change", (properties) => {
    if (!properties.accounts) return;
    onAccounts(properties.accounts);
  });
}
