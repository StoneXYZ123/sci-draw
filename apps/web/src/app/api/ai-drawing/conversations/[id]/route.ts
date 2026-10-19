import { deleteConversation, getConversationDetail } from "@/lib/conversations";
import { jsonNoStore } from "@/lib/http";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONVERSATION_ID = /^[0-9a-f-]{36}$/;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  const { id } = await context.params;
  if (!CONVERSATION_ID.test(id)) {
    return jsonNoStore({ error: "Not found" }, 404);
  }
  const detail = await getConversationDetail(sessionUser.id, id);
  if (!detail) {
    return jsonNoStore({ error: "Not found" }, 404);
  }
  return jsonNoStore(detail);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  const { id } = await context.params;
  if (!CONVERSATION_ID.test(id)) {
    return jsonNoStore({ error: "Not found" }, 404);
  }
  const deleted = await deleteConversation(sessionUser.id, id);
  if (!deleted) {
    return jsonNoStore({ error: "Not found" }, 404);
  }
  return jsonNoStore({ ok: true });
}
