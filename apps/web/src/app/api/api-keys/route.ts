import { z } from "zod";
import { createApiKey, listApiKeys } from "@/lib/api-keys";
import { jsonNoStore } from "@/lib/http";
import { takeRateLimit } from "@/lib/rate-limit";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export async function GET(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  const keys = await listApiKeys(sessionUser.id);
  return jsonNoStore({
    keys: keys.map((item) => ({
      id: item.id,
      name: item.name,
      prefix: item.prefix,
      createdAt: item.createdAt.toISOString(),
      lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
      revokedAt: item.revokedAt?.toISOString() ?? null,
    })),
  });
}

export async function POST(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  if (!takeRateLimit(`api-key-create:${sessionUser.id}`, 10, 60 * 60_000)) {
    return jsonNoStore({ error: "Too many API keys created" }, 429);
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonNoStore({ error: "Invalid request" }, 400);
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return jsonNoStore({ error: "Invalid request" }, 400);
  }
  const created = await createApiKey(sessionUser.id, parsed.data.name);
  return jsonNoStore(
    {
      id: created.id,
      name: created.name,
      prefix: created.prefix,
      secret: created.secret,
      createdAt: created.createdAt.toISOString(),
    },
    201,
  );
}
