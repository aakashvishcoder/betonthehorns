import { useEffect, useSyncExternalStore } from "react";

// Whether the coach is switched off, e.g. while the player sits at a ranked table.
// The table page calls useBlockCoach(isRanked); the coach widget reads useCoachBlocked().
let blockers = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useBlockCoach(blocked: boolean) {
  useEffect(() => {
    if (!blocked) return;
    blockers++;
    emit();
    return () => {
      blockers--;
      emit();
    };
  }, [blocked]);
}

export function useCoachBlocked() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => blockers > 0,
  );
}
