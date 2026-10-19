export function isUniqueViolation(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (typeof current !== "object" || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if ("code" in current && current.code === "23505") {
      return true;
    }
    if ("cause" in current) {
      pending.push(current.cause);
    }
  }
  return false;
}
