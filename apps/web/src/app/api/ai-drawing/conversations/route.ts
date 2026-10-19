import { conversationPage, listConversations } from "@/lib/conversations";
import { jsonNoStore } from "@/lib/http";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }
  const url = new URL(request.url);
  const page = conversationPage(url.searchParams.get("limit"), url.searchParams.get("offset"));
  const conversations = await listConversations(sessionUser.id, page.limit, page.offset);
  return jsonNoStore({ conversations });
}
