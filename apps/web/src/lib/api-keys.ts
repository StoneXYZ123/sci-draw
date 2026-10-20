import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { apiKey } from "@/db/schema";
import { getDb } from "@/db";

const KEY_PATTERN = /^sd_[A-Za-z0-9_-]{20,120}$/;

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function generateApiKey(): { secret: string; hash: string; prefix: string } {
  const secret = `sd_${randomBytes(32).toString("base64url")}`;
  return { secret, hash: hashApiKey(secret), prefix: secret.slice(0, 11) };
}

export async function createApiKey(userId: string, name: string): Promise<{ id: string; name: string; secret: string; prefix: string; createdAt: Date }> {
  const generated = generateApiKey();
  const id = randomUUID();
  const createdAt = new Date();
  await getDb().insert(apiKey).values({
    id,
    userId,
    name,
    keyPrefix: generated.prefix,
    keyHash: generated.hash,
    createdAt,
  });
  return { id, name, secret: generated.secret, prefix: generated.prefix, createdAt };
}

export async function listApiKeys(userId: string) {
  const rows = await getDb()
    .select({
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.keyPrefix,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
      createdAt: apiKey.createdAt,
    })
    .from(apiKey)
    .where(eq(apiKey.userId, userId))
    .orderBy(desc(apiKey.createdAt));
  return rows;
}

export async function revokeApiKey(userId: string, id: string): Promise<boolean> {
  const updated = await getDb()
    .update(apiKey)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKey.id, id), eq(apiKey.userId, userId), isNull(apiKey.revokedAt)))
    .returning({ id: apiKey.id });
  if (updated.length > 0) {
    return true;
  }
  const [existing] = await getDb()
    .select({ id: apiKey.id, revokedAt: apiKey.revokedAt })
    .from(apiKey)
    .where(and(eq(apiKey.id, id), eq(apiKey.userId, userId)))
    .limit(1);
  return Boolean(existing?.revokedAt);
}

export async function userForApiKey(secret: string): Promise<{ id: string; userId: string } | null> {
  if (!KEY_PATTERN.test(secret)) {
    return null;
  }
  const [row] = await getDb()
    .select({ id: apiKey.id, userId: apiKey.userId, revokedAt: apiKey.revokedAt })
    .from(apiKey)
    .where(eq(apiKey.keyHash, hashApiKey(secret)))
    .limit(1);
  if (!row || row.revokedAt) {
    return null;
  }
  await getDb().update(apiKey).set({ lastUsedAt: new Date() }).where(eq(apiKey.id, row.id));
  return { id: row.id, userId: row.userId };
}
