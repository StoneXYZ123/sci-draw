"use server";

import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { deleteConversation } from "@/lib/conversations";

const CONVERSATION_ID = /^[0-9a-f-]{36}$/;

export async function deleteConversationAction(conversationId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { ok: false, error: "Unauthorized" };
  }
  if (!CONVERSATION_ID.test(conversationId)) {
    return { ok: false, error: "Conversation was not found" };
  }
  const deleted = await deleteConversation(session.user.id, conversationId);
  if (!deleted) {
    return { ok: false, error: "Conversation was not found" };
  }
  return { ok: true };
}
