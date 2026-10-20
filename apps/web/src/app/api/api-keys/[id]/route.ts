import { revokeApiKey } from "@/lib/api-keys";
import { jsonNoStore } from "@/lib/http";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  const { id } = await context.params;
  const revoked = await revokeApiKey(sessionUser.id, id);
  if (!revoked) {
    return jsonNoStore({ error: "API key was not found" }, 404);
  }
  return jsonNoStore({ id, revoked: true });
}
