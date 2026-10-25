import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type express from "express";
import { loginMessage, newNonce, verifyLogin } from "./src/auth.ts";

/**
 * Signed wallet login, stateless so it works across serverless instances. The client asks for a
 * challenge, the wallet signs "Bet on the Horns login: <nonce>" (free, no transaction), and the
 * server checks the ed25519 signature and returns a session token valid for 12 hours.
 * Challenges and tokens carry their own expiry and an HMAC, so any instance can verify them
 * without shared memory. Every wallet-scoped route reads the wallet from the token; a walletId
 * sent in a body/query is never trusted.
 *
 * ponytail: no server-side revocation (logout just forgets the token in the browser) and a
 * challenge can be reused within its 5 minutes by someone holding the signature; store used
 * nonces / revoked tokens in the database if that ever matters.
 */
const CHALLENGE_MS = 5 * 60_000;
export const SESSION_MS = 12 * 60 * 60_000;

/** SESSION_SECRET, or one derived from the Ably root key every instance already has. */
function secret() {
  const explicit = process.env.SESSION_SECRET?.trim();
  if (explicit) return explicit;
  const fallback = process.env.ABLY_ROOT_KEY?.trim() || process.env.DATABASE_URL?.trim();
  if (!fallback) throw new Error("SESSION_SECRET is missing");
  return createHash("sha256").update(`horns-session:${fallback}`).digest("hex");
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

function signedOk(payload: string, mac: string) {
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function issueChallenge(walletId: string) {
  const expires = Date.now() + CHALLENGE_MS;
  const body = `${newNonce()}.${expires}`;
  const nonce = `${body}.${sign(`challenge|${walletId}|${body}`)}`;
  return { nonce, message: loginMessage(nonce) };
}

/** Returns a session token, or null if the challenge or signature doesn't check out. */
export function login(walletId: string, signatureBase64: string, nonce: string) {
  const parts = nonce.split(".");
  if (parts.length !== 3) return null;
  const [random, expiresText, mac] = parts as [string, string, string];
  const body = `${random}.${expiresText}`;
  if (!signedOk(`challenge|${walletId}|${body}`, mac)) return null;
  if (!(Number(expiresText) > Date.now())) return null;
  if (!verifyLogin(walletId, nonce, signatureBase64)) return null;
  const expires = Date.now() + SESSION_MS;
  const token = `${walletId}.${expires}.${sign(`session|${walletId}|${expires}`)}`;
  return { token, expires };
}

/** The signed-in wallet for this request, or null. */
export function sessionWallet(req: { header(name: string): string | undefined }): string | null {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [walletId, expiresText, mac] = token.split(".");
  if (!walletId || !expiresText || !mac) return null;
  if (!(Number(expiresText) > Date.now())) return null;
  return signedOk(`session|${walletId}|${expiresText}`, mac) ? walletId : null;
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
