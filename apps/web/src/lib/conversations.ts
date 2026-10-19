import { and, asc, desc, eq } from "drizzle-orm";
import { conversation, message } from "@/db/schema";
import { getDb } from "@/db";

export type ConversationListItem = {
  id: string;
  mode: string;
  title: string;
  initialPrompt: string | null;
  createdAt: string;
  updatedAt: string;
  previewImageUrl: string | null;
  messageCount: number;
};

export type ConversationMessage = {
  id: string;
  role: string;
  content: string;
  contentType: string;
  conversationId: string;
  createdAt: string;
  metadata: string | null;
};

function iso(value: Date): string {
  return value.toISOString();
}

function toListItem(row: typeof conversation.$inferSelect): ConversationListItem {
  return {
    id: row.id,
    mode: row.mode,
    title: row.title,
    initialPrompt: row.initialPrompt,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    previewImageUrl: row.previewImageUrl,
    messageCount: row.messageCount,
  };
}

export function conversationPage(limitValue: string | null, offsetValue: string | null): { limit: number; offset: number } {
  const limitParsed = Number(limitValue ?? "20");
  const offsetParsed = Number(offsetValue ?? "0");
  const limit = Number.isInteger(limitParsed) ? Math.min(50, Math.max(1, limitParsed)) : 20;
  const offset = Number.isInteger(offsetParsed) ? Math.min(10_000, Math.max(0, offsetParsed)) : 0;
  return { limit, offset };
}

export async function listConversations(userId: string, limit: number, offset: number): Promise<ConversationListItem[]> {
  const rows = await getDb()
    .select()
    .from(conversation)
    .where(and(eq(conversation.userId, userId), eq(conversation.product, "ai_drawing")))
    .orderBy(desc(conversation.updatedAt))
    .limit(limit)
    .offset(offset);
  return rows.map(toListItem);
}

export async function getConversationDetail(
  userId: string,
  conversationId: string,
): Promise<{ conversation: ConversationListItem; messages: ConversationMessage[] } | null> {
  const [row] = await getDb()
    .select()
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), eq(conversation.userId, userId), eq(conversation.product, "ai_drawing")))
    .limit(1);
  if (!row) {
    return null;
  }
  const messages = await getDb()
    .select()
    .from(message)
    .where(eq(message.conversationId, row.id))
    .orderBy(asc(message.createdAt), asc(message.id));
  return {
    conversation: toListItem(row),
    messages: messages.map((item) => ({
      id: item.id,
      role: item.role,
      content: item.content,
      contentType: item.contentType,
      conversationId: item.conversationId,
      createdAt: iso(item.createdAt),
      metadata: item.metadata,
    })),
  };
}

export async function deleteConversation(userId: string, conversationId: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(conversation)
    .where(and(eq(conversation.id, conversationId), eq(conversation.userId, userId), eq(conversation.product, "ai_drawing")))
    .returning({ id: conversation.id });
  return deleted.length > 0;
}
