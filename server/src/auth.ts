import { createPublicKey, randomBytes, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export const newNonce = () => randomBytes(16).toString("hex");

/** The exact text a wallet signs to log in (Phantom's signMessage). */
export const loginMessage = (nonce: string) => `Bet on the Horns login: ${nonce}`;

/** True if `signature` (base64) is `wallet`'s ed25519 signature of the login message. */
export function verifyLogin(wallet: string, nonce: string, signature: string): boolean {
  try {
    const x = Buffer.from(new PublicKey(wallet).toBytes()).toString("base64url");
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
    return verify(null, Buffer.from(loginMessage(nonce)), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
