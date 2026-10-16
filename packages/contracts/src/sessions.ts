import { z } from "zod";

const epochMs = z.int().nonnegative();

export const SessionCloseReason = z.enum(["reset", "instructions_changed"]);
export type SessionCloseReason = z.infer<typeof SessionCloseReason>;

/** A closed Session is read-only and stays as a record. */
export const SessionItem = z.strictObject({
  id: z.string(),
  conversationId: z.string(),
  botId: z.string(),
  status: z.enum(["open", "closed"]),
  botInstructionsVersion: z.int().positive(),
  openedAt: epochMs,
  closedAt: epochMs.optional(),
  closedBy: SessionCloseReason.optional(),
});
export type SessionItem = z.infer<typeof SessionItem>;

export const ResetSessionResponse = z.strictObject({
  closed: SessionItem.optional(),
});
export type ResetSessionResponse = z.infer<typeof ResetSessionResponse>;
