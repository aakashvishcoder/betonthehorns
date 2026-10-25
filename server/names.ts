const names = new Map<string, string>();

export function rememberName(walletId: string, name: string | null) {
  if (name) names.set(walletId, name);
  else names.delete(walletId);
}

export function lookupName(walletId: string) {
  return names.get(walletId) ?? null;
}

export function seatLabel(walletId: string) {
  return (
    lookupName(walletId) ??
    `${walletId.slice(0, 4)}…${walletId.slice(-4)}`
  );
}

export function cleanDisplayName(input: string) {
  const name = input.trim().replace(/\s+/g, " ");
  if (!name) return null;
  if (name.length > 18) throw new Error("Display name must be 18 characters or fewer");
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _.'-]{0,17}$/u.test(name)) {
    throw new Error("Use letters, numbers, spaces, apostrophes, or hyphens");
  }
  return name;
}
