import { createHash, randomBytes } from "node:crypto";

export function newCommit() {
  const seed = randomBytes(32);
  const commitHash = createHash("sha256").update(seed).digest("hex");
  return { seed: seed.toString("hex"), commitHash };
}

export function seededShuffle<T>(items: T[], seedHex: string, counter: number) {
  const next = [...items];
  const digest = createHash("sha256")
    .update(Buffer.from(seedHex, "hex"))
    .update(Buffer.from(String(counter)))
    .digest();
  let state = digest.readUInt32BE(0) || 1;
  const rand = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const swap = next[i]!;
    next[i] = next[j]!;
    next[j] = swap;
  }
  return next;
}
