import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import WalletPicker, {
  type WalletChoice,
} from "@/components/auth/WalletPicker";
import { api } from "@/lib/api";
import {
  SESSION_EXPIRED,
  clearSession as clearServerSession,
  loadSession,
  resumeSession,
  saveSession,
} from "@/lib/session";
import {
  connectSolanaWallet,
  disconnectSolanaWallet,
  listSolanaWallets,
  signTextMessage,
  subscribeSolanaWallets,
  waitForSolanaWallets,
  watchSolanaAccounts,
} from "@/lib/solana-wallets";
import { walletToast } from "@/lib/wallet-toast";

export type AuthStatus =
  | "restoring"
  | "connecting"
  /** Wallet connected; waiting for it to sign the one-time login message. */
  | "signing"
  | "connected"
  | "disconnected";

export type AuthState = {
  /** True when a Solana account is connected and has signed in to the server. */
  isAuthenticated: boolean;
  status: AuthStatus;
  /** Base58 public key of the connected account. */
  address: string | null;
  /** Short address for buttons and headers, such as Ab12…9xYZ. */
  displayAddress: string | null;
  walletName: string | null;
  /** Prompt for a Solana wallet. Returns the address, or null if cancelled. */
  connect: () => Promise<string | null>;
  disconnect: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function displayAddress(address: string | null) {
  if (!address) return null;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

function wasRejected(error: unknown) {
  return /reject|cancel|denied|closed/i.test(errorText(error));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("restoring");
  const [address, setAddress] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [pickerWallets, setPickerWallets] = useState<WalletChoice[] | null>(
    null,
  );

  const addressRef = useRef<string | null>(null);
  const activeWalletRef = useRef<Wallet | null>(null);
  const accountRef = useRef<WalletAccount | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const signingFor = useRef<string | null>(null);
  const unwatchRef = useRef<(() => void) | null>(null);
  const explicitRef = useRef(false);
  const connectLock = useRef<Promise<string | null> | null>(null);
  const choiceResolve = useRef<((name: string | null) => void) | null>(null);

  const clearSession = useCallback(() => {
    unwatchRef.current?.();
    unwatchRef.current = null;
    activeWalletRef.current = null;
    accountRef.current = null;
    if (addressRef.current) clearServerSession(addressRef.current);
    setSignedIn(false);
    addressRef.current = null;
    setAddress(null);
    setWalletName(null);
    setStatus("disconnected");
  }, []);

  const adopt = useCallback((wallet: Wallet, account: WalletAccount) => {
    unwatchRef.current?.();
    activeWalletRef.current = wallet;
    accountRef.current = account;
    addressRef.current = account.address;
    setAddress(account.address);
    setWalletName(wallet.name);
    setStatus("connected");
    unwatchRef.current = watchSolanaAccounts(wallet, (accounts) => {
      const next = accounts[0];
      if (!next) {
        unwatchRef.current?.();
        unwatchRef.current = null;
        activeWalletRef.current = null;
        addressRef.current = null;
        setAddress(null);
        setWalletName(null);
        setStatus("disconnected");
        return;
      }
      accountRef.current = next;
      addressRef.current = next.address;
      setSignedIn(false);
      setAddress(next.address);
    });
  }, []);

  /**
   * Signs in to the game server: reuse a saved session for this wallet, or have the wallet
   * sign a one-time login message (free; no transaction) and trade it for a 12-hour session.
   */
  const signIn = useCallback(async (forAddress: string) => {
    const saved = loadSession(forAddress);
    if (saved) {
      resumeSession(forAddress, saved);
      setSignedIn(true);
      return;
    }
    const wallet = activeWalletRef.current;
    const account = accountRef.current;
    if (!wallet || !account || signingFor.current === forAddress) return;
    signingFor.current = forAddress;
    setStatus("signing");
    try {
      const { nonce, message } = await api.authChallenge(forAddress);
      const signature = await signTextMessage(wallet, account, message);
      const session = await api.login(forAddress, signature, nonce);
      if (addressRef.current !== forAddress) return;
      saveSession(forAddress, session.token, session.expires);
      setSignedIn(true);
      setStatus("connected");
    } catch (error) {
      if (addressRef.current !== forAddress) return;
      // Without a signature the server can't tell it's really you, so treat it as signed out.
      walletToast.error(
        wasRejected(error)
          ? "Sign the login message to play. It's free and doesn't move any funds."
          : `Couldn't sign in: ${errorText(error) || "server unavailable"}`,
      );
      explicitRef.current = true;
      unwatchRef.current?.();
      unwatchRef.current = null;
      activeWalletRef.current = null;
      accountRef.current = null;
      addressRef.current = null;
      setAddress(null);
      setWalletName(null);
      setSignedIn(false);
      setStatus("disconnected");
    } finally {
      signingFor.current = null;
    }
  }, []);

  // Sign in whenever a wallet connects (or switches accounts).
  useEffect(() => {
    if (status === "connected" && address && !signedIn) void signIn(address);
  }, [address, signIn, signedIn, status]);

  // The server dropped our session (expired, or restarted): forget it and sign again.
  useEffect(() => {
    const onExpired = () => {
      const current = addressRef.current;
      if (!current) return;
      clearServerSession(current);
      setSignedIn(false);
    };
    window.addEventListener(SESSION_EXPIRED, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED, onExpired);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let silentLock = false;
    let rerun = false;

    const trySilent = async () => {
      if (cancelled || explicitRef.current || addressRef.current) return;
      if (silentLock) {
        rerun = true;
        return;
      }
      silentLock = true;
      try {
        do {
          rerun = false;
          const wallets = listSolanaWallets();
          if (wallets.length === 0) return;
          await Promise.all(
            wallets.map(async (wallet) => {
              if (cancelled || explicitRef.current || addressRef.current) return;
              try {
                const account = await connectSolanaWallet(wallet, true);
                if (
                  !account ||
                  cancelled ||
                  explicitRef.current ||
                  addressRef.current
                ) {
                  return;
                }
                adopt(wallet, account);
              } catch {
                // A silent connect fails when the wallet has not been approved yet.
              }
            }),
          );
        } while (rerun && !cancelled && !addressRef.current && !explicitRef.current);
      } finally {
        silentLock = false;
        if (!cancelled && !addressRef.current && !explicitRef.current) {
          const found = listSolanaWallets();
          if (found.length > 0) {
            setStatus((current) =>
              current === "restoring" ? "disconnected" : current,
            );
          }
        }
      }
    };

    void trySilent();
    const stop = subscribeSolanaWallets(() => {
      void trySilent();
    });
    const finish = window.setTimeout(() => {
      if (cancelled || addressRef.current || explicitRef.current) return;
      setStatus((current) => (current === "restoring" ? "disconnected" : current));
    }, 700);

    return () => {
      cancelled = true;
      window.clearTimeout(finish);
      stop();
    };
  }, [adopt]);

  const connect = useCallback(() => {
    if (addressRef.current) return Promise.resolve(addressRef.current);
    if (connectLock.current) return connectLock.current;

    const run = (async () => {
      explicitRef.current = true;
      setStatus("connecting");
      const wallets = await waitForSolanaWallets(700);
      if (wallets.length === 0) {
        setStatus("disconnected");
        walletToast.error(
          "No Solana wallet found. Install one in this browser, such as Phantom, Solflare, or Backpack.",
        );
        return null;
      }

      let wallet = wallets[0]!;
      if (wallets.length > 1) {
        const name = await new Promise<string | null>((resolve) => {
          choiceResolve.current = resolve;
          setPickerWallets(
            wallets.map((item) => ({ name: item.name, icon: item.icon })),
          );
        });
        choiceResolve.current = null;
        setPickerWallets(null);
        if (!name) {
          setStatus("disconnected");
          walletToast.error("Wallet connection was cancelled.");
          return null;
        }
        const chosen = wallets.find((item) => item.name === name);
        if (!chosen) {
          setStatus("disconnected");
          return null;
        }
        wallet = chosen;
      }

      try {
        const account = await connectSolanaWallet(wallet);
        if (!account) {
          setStatus("disconnected");
          walletToast.error("That wallet did not return a Solana account.");
          return null;
        }
        adopt(wallet, account);
        walletToast.success(`Connected ${wallet.name}.`);
        return account.address;
      } catch (error) {
        setStatus("disconnected");
        walletToast.error(
          wasRejected(error)
            ? "Wallet connection was cancelled."
            : "Could not connect to that Solana wallet.",
        );
        return null;
      }
    })().finally(() => {
      connectLock.current = null;
    });

    connectLock.current = run;
    return run;
  }, [adopt]);

  const disconnect = useCallback(async () => {
    const wallet = activeWalletRef.current;
    explicitRef.current = true;
    void api.logout().catch(() => {});
    clearSession();
    if (!wallet) return;
    try {
      await disconnectSolanaWallet(wallet);
    } catch {
      // The app session is already cleared.
    }
  }, [clearSession]);

  const chooseWallet = (name: string) => {
    choiceResolve.current?.(name);
  };

  const cancelPicker = () => {
    choiceResolve.current?.(null);
  };

  const value = useMemo<AuthState>(
    () => ({
      isAuthenticated: status === "connected" && Boolean(address) && signedIn,
      status,
      address,
      displayAddress: displayAddress(address),
      walletName,
      connect,
      disconnect,
    }),
    [address, connect, disconnect, signedIn, status, walletName],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {pickerWallets && (
        <WalletPicker
          wallets={pickerWallets}
          onSelect={chooseWallet}
          onCancel={cancelPicker}
        />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return value;
}
