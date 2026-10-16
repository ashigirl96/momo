import { z } from "zod";
import { RunItem } from "./runs.ts";

const epochMs = z.int().nonnegative();

export const MESSAGE_TEXT_MAX = 4000;

/** Who wrote a public message. The text is Markdown and the UI sanitizes it before drawing. */
export const MessageAuthor = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("owner") }),
  z.strictObject({ kind: z.literal("bot"), botId: z.string(), runId: z.string() }),
]);
export type MessageAuthor = z.infer<typeof MessageAuthor>;

/** A public message of a Conversation. #45 adds its Attachments. */
export const MessageItem = z.strictObject({
  id: z.string(),
  conversationId: z.string(),
  author: MessageAuthor,
  text: z.string(),
  createdAt: epochMs,
});
export type MessageItem = z.infer<typeof MessageItem>;

export const MessagePage = z.strictObject({
  messages: z.array(MessageItem),
  nextCursor: z.string().optional(),
  /**
   * Subscribe to the Conversation's events after this id. It points before any unfinished Run's
   * first event, so a reload replays that Run's stream; a message seen twice is the same id.
   */
  streamAfter: z.int().nonnegative(),
});
export type MessagePage = z.infer<typeof MessagePage>;

export const PostMessageRequest = z.strictObject({
  text: z.string().trim().min(1).max(MESSAGE_TEXT_MAX),
});
export type PostMessageRequest = z.input<typeof PostMessageRequest>;

export const PostMessageResponse = z.strictObject({
  message: MessageItem,
  run: RunItem,
});
export type PostMessageResponse = z.infer<typeof PostMessageResponse>;
