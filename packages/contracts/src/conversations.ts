import { z } from "zod";

const epochMs = z.int().nonnegative();

export const ParticipantRole = z.enum(["primary", "member"]);
export type ParticipantRole = z.infer<typeof ParticipantRole>;

export const ConversationItem = z.strictObject({
  id: z.string(),
  primaryBotId: z.string(),
  createdAt: epochMs,
});
export type ConversationItem = z.infer<typeof ConversationItem>;

export const ConversationDetail = ConversationItem.extend({
  participants: z.array(z.strictObject({ botId: z.string(), role: ParticipantRole })),
});
export type ConversationDetail = z.infer<typeof ConversationDetail>;

export const ConversationList = z.strictObject({
  conversations: z.array(ConversationItem),
  nextCursor: z.string().optional(),
});
export type ConversationList = z.infer<typeof ConversationList>;

/** The Workspace comes from the path and the id from the backend; a request naming either is refused. */
export const CreateConversationRequest = z.strictObject({
  primaryBotId: z.string().min(1).max(200),
});
export type CreateConversationRequest = z.input<typeof CreateConversationRequest>;
