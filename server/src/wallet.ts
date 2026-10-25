import { generateKeyPairSync, sign } from "node:crypto";
import { loginMessage } from "./auth.ts";
import { encodeBase58 } from "./base58.ts";

/** A throwaway ed25519 wallet for bots and tests: a Solana-style address that can sign the login message. */
export function fakeWallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const address = encodeBase58(Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url"));
  return {
    address,
    signLogin: (nonce: string) => sign(null, Buffer.from(loginMessage(nonce)), privateKey).toString("base64"),
  };
}
