import { createHash } from "node:crypto";

export class IdempotencyKeyError extends Error {
  readonly errorCode = "INVALID_IDEMPOTENCY_KEY" as const;

  constructor() {
    super("Idempotency-Key must be 8 to 200 letters, numbers, dots, colons, underscores, or hyphens");
    this.name = "IdempotencyKeyError";
  }
}

export class IdempotencyConflictError extends Error {
  readonly errorCode = "IDEMPOTENCY_CONFLICT" as const;

  constructor() {
    super("Idempotency-Key was already used with a different request");
    this.name = "IdempotencyConflictError";
  }
}

export function readIdempotencyKey(request: Request): string | null {
  const raw = request.headers.get("idempotency-key");
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const key = raw.trim();
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) {
    throw new IdempotencyKeyError();
  }
  return key;
}

export function scopedBatchId(scope: string, userId: string, key: string): string {
  const digest = createHash("sha256").update(`${scope}\n${userId}\n${key}`).digest("hex").slice(0, 40);
  return `${scope}-${digest}`;
}

export function requestHash(parts: Array<string | number | undefined>): string {
  return createHash("sha256").update(parts.map((part) => String(part ?? "")).join("\n")).digest("hex");
}
