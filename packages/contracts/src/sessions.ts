import { z } from "zod";

const epochMs = z.int().nonnegative();

/** Why a Session closed: the owner reset it, or the Bot's instructions changed. */
export const SessionCloseReason = z.enum(["reset", "instructions_changed"]);
export type SessionCloseReason = z.infer<typeof SessionCloseReason>;

/** One Bot's model context in a Conversation. A closed Session is read-only and stays as a record. */
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

/** After a reset the Conversation goes on in a new Session from the next message. */
export const ResetSessionResponse = z.strictObject({
  closed: SessionItem.optional(),
});
export type ResetSessionResponse = z.infer<typeof ResetSessionResponse>;
