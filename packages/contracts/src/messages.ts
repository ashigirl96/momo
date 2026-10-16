import { z } from "zod";
import { RunItem } from "./runs.ts";
import { SessionItem } from "./sessions.ts";

const epochMs = z.int().nonnegative();

export const MESSAGE_TEXT_MAX = 4000;

/** The text is Markdown, and the UI sanitizes it before drawing. */
export const MessageAuthor = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("owner") }),
  z.strictObject({
    kind: z.literal("bot"),
    botId: z.string(),
    runId: z.string(),
    // Stored events may lack the flag.
    cancelled: z.boolean().default(false),
  }),
]);
export type MessageAuthor = z.infer<typeof MessageAuthor>;

export const ATTACHMENT_SIZE_MAX = 10 * 1024 * 1024;
export const ATTACHMENTS_PER_MESSAGE_MAX = 4;

/** Its bytes are served only inside a sandboxed frame. */
export const AttachmentItem = z.strictObject({
  id: z.string(),
  name: z.string(),
  contentType: z.string(),
  size: z.int().nonnegative(),
});
export type AttachmentItem = z.infer<typeof AttachmentItem>;

export const MessageItem = z.strictObject({
  id: z.string(),
  conversationId: z.string(),
  author: MessageAuthor,
  /** Optional, because stored events may lack it. */
  sessionId: z.string().optional(),
  text: z.string(),
  // Stored events may lack the list.
  attachments: z.array(AttachmentItem).default([]),
  createdAt: epochMs,
});
export type MessageItem = z.infer<typeof MessageItem>;

export const MessagePage = z.strictObject({
  messages: z.array(MessageItem),
  nextCursor: z.string().optional(),
  sessions: z.array(SessionItem),
  /** It points before any unfinished Run's first event, so a reload replays that Run's stream. */
  streamAfter: z.int().nonnegative(),
});
export type MessagePage = z.infer<typeof MessagePage>;

/** With files the body is multipart/form-data: a `text` field, which may be empty, and up to ATTACHMENTS_PER_MESSAGE_MAX `file` fields. */
export const PostMessageRequest = z.strictObject({
  text: z.string().trim().min(1).max(MESSAGE_TEXT_MAX),
});
export type PostMessageRequest = z.input<typeof PostMessageRequest>;

export const PostMessageResponse = z.strictObject({
  message: MessageItem,
  run: RunItem,
});
export type PostMessageResponse = z.infer<typeof PostMessageResponse>;
