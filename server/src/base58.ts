// Bitcoin/Solana base58, as used for wallet addresses.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function encodeBase58(bytes: Uint8Array): string {
  let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0"));
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function decodeBase58(text: string): Uint8Array {
  let n = 0n;
  for (const ch of text) {
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) throw new Error("invalid base58");
    n = n * 58n + BigInt(digit);
  }
  let hex = n === 0n ? "" : n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const zeros = text.match(/^1*/)![0].length;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...Buffer.from(hex, "hex")]);
}
