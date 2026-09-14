/** Reject unsafe RTDB payloads without deleting or disguising required domain fields. */
export function findUndefinedPath(value: unknown, path = "values", seen = new WeakSet<object>()): string | null {
  if (value === undefined) return path;
  if (value === null || typeof value !== "object") return null;
  if (seen.has(value as object)) return null;
  seen.add(value as object);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const found = findUndefinedPath(child, `${path}.${key}`, seen);
    if (found) return found;
  }
  return null;
}

export function assertNoUndefinedValues(value: unknown, path = "values"): void {
  const invalidPath = findUndefinedPath(value, path);
  if (invalidPath) throw new Error(`Unsafe Firebase payload contains undefined at '${invalidPath}'.`);
}
