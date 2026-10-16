import { z } from "zod";

const epochMs = z.int().nonnegative();

export const MEMORY_BODY_MAX = 20000;
export const MEMORY_QUERY_MAX = 200;

/** `resource` is shown to the owner and never used to decide anything. */
export const MemoryItemDraft = z.strictObject({
  type: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(1000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  resource: z.string().trim().min(1).max(2000).optional(),
  body: z.string().trim().min(1).max(MEMORY_BODY_MAX),
});
export type MemoryItemDraft = z.infer<typeof MemoryItemDraft>;

export const MemoryHit = MemoryItemDraft.extend({ id: z.string() });
export type MemoryHit = z.infer<typeof MemoryHit>;

/** A Bot's write names its Run's Conversation until that Conversation is deleted. */
export const MemoryProvenance = z.discriminatedUnion("writer", [
  z.strictObject({
    writer: z.literal("bot"),
    source: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("conversation"), conversationId: z.string(), runId: z.string() }),
      z.strictObject({ kind: z.literal("deleted_conversation") }),
    ]),
  }),
  z.strictObject({ writer: z.literal("owner") }),
]);
export type MemoryProvenance = z.infer<typeof MemoryProvenance>;

export const MemoryItem = MemoryItemDraft.extend({
  id: z.string(),
  botId: z.string(),
  created: MemoryProvenance,
  updated: MemoryProvenance,
  createdAt: epochMs,
  updatedAt: epochMs,
});
export type MemoryItem = z.infer<typeof MemoryItem>;

export const MemoryList = z.strictObject({
  items: z.array(MemoryItem),
  nextCursor: z.string().optional(),
});
export type MemoryList = z.infer<typeof MemoryList>;
