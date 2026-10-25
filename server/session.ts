import { randomBytes } from "node:crypto";
import type express from "express";
import { loginMessage, newNonce, verifyLogin } from "./src/auth.ts";

/**
 * Signed wallet login. The client asks for a challenge, the wallet signs
 * "Bet on the Horns login: <nonce>" (free, no transaction), and the server checks the
 * ed25519 signature and returns a session token valid for 12 hours. Every wallet-scoped
 * route reads the wallet from that token; a walletId sent in a body/query is never trusted.
 */
const CHALLENGE_MS = 5 * 60_000;
export const SESSION_MS = 12 * 60 * 60_000;

const challenges = new Map<string, { nonce: string; expires: number }>();
const sessions = new Map<string, { walletId: string; expires: number }>();

export function issueChallenge(walletId: string) {
  const nonce = newNonce();
  challenges.set(walletId, { nonce, expires: Date.now() + CHALLENGE_MS });
  return { nonce, message: loginMessage(nonce) };
}

/** Returns a session token, or null if the signature doesn't check out. */
export function login(walletId: string, signatureBase64: string) {
  const challenge = challenges.get(walletId);
  challenges.delete(walletId); // one attempt per challenge
  if (!challenge || challenge.expires < Date.now()) return null;
  if (!verifyLogin(walletId, challenge.nonce, signatureBase64)) return null;
  const token = randomBytes(32).toString("base64url");
  const expires = Date.now() + SESSION_MS;
  sessions.set(token, { walletId, expires });
  return { token, expires };
}

export function logout(token: string) {
  sessions.delete(token);
}

/** The signed-in wallet for this request, or null. */
export function sessionWallet(req: express.Request): string | null {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = token ? sessions.get(token) : undefined;
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session.walletId;
}

/** Use in handlers: the wallet, or a 401 already sent (returns null). */
export function requireWallet(req: express.Request, res: express.Response): string | null {
  const walletId = sessionWallet(req);
  if (!walletId) {
    res.status(401).json({ error: "Sign in with your wallet first." });
    return null;
  }
  return walletId;
}

// Drop expired entries now and then so the maps don't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of challenges) if (v.expires < now) challenges.delete(k);
  for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
}, 10 * 60_000).unref();
