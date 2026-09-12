import { useLiveQuery } from "dexie-react-hooks";

export function useLive<T>(fn: () => Promise<T[]>, deps: unknown[] = []): T[] {
  const result = useLiveQuery(async () => {
    if (typeof window === "undefined") return [] as T[];
    try { return await fn(); } catch { return [] as T[]; }
  }, deps, [] as T[]);
  return result ?? ([] as T[]);
}

export function useLiveOne<T>(fn: () => Promise<T | undefined>, deps: unknown[] = []): T | undefined {
  return useLiveQuery(async () => {
    if (typeof window === "undefined") return undefined;
    try { return await fn(); } catch { return undefined; }
  }, deps, undefined as T | undefined);
}

