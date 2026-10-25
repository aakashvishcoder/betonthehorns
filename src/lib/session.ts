/**
 * The server session for the signed-in wallet. A token comes from signing a one-time login
 * message; it's kept per wallet for its 12-hour life so reloading the page doesn't prompt again.
 */
type Stored = { token: string; expires: number };

const key = (address: string) => `horns-session:${address}`;
let active: { address: string; token: string } | null = null;

export function loadSession(address: string): string | null {
  try {
    const raw = localStorage.getItem(key(address));
    if (!raw) return null;
    const saved = JSON.parse(raw) as Stored;
    if (saved.expires - Date.now() < 60_000) {
      localStorage.removeItem(key(address));
      return null;
    }
    return saved.token;
  } catch {
    return null;
  }
}

export function saveSession(address: string, token: string, expires: number) {
  active = { address, token };
  try {
    localStorage.setItem(key(address), JSON.stringify({ token, expires } satisfies Stored));
  } catch {
    // Private mode etc.: the session still works for this page.
  }
}

export function resumeSession(address: string, token: string) {
  active = { address, token };
}

export function clearSession(address?: string) {
  const target = address ?? active?.address;
  if (target) {
    try {
      localStorage.removeItem(key(target));
    } catch {
      // ignore
    }
  }
  if (!address || active?.address === address) active = null;
}

/** Header for API calls while signed in. */
export function sessionHeader(): Record<string, string> {
  return active ? { Authorization: `Bearer ${active.token}` } : {};
}

/** The server rejected the session (expired, or the server restarted): ask the wallet again. */
export const SESSION_EXPIRED = "horns:session-expired";
