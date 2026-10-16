import { z } from "zod";
import { RunItem } from "./runs.ts";
import { SessionItem } from "./sessions.ts";

const epochMs = z.int().nonnegative();

export const MESSAGE_TEXT_MAX = 4000;

/**
 * Who wrote a public message. The text is Markdown and the UI sanitizes it before drawing.
 * A Bot's message is `cancelled` when the owner stopped its Run, so the text ends part way.
 */
export const MessageAuthor = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("owner") }),
  z.strictObject({
    kind: z.literal("bot"),
    botId: z.string(),
    runId: z.string(),
    // Events logged before Runs could be cancelled carry no flag.
    cancelled: z.boolean().default(false),
  }),
]);
export type MessageAuthor = z.infer<typeof MessageAuthor>;

export const ATTACHMENT_SIZE_MAX = 10 * 1024 * 1024;
export const ATTACHMENTS_PER_MESSAGE_MAX = 4;

/** A file on a public message. Its bytes are served only inside a sandboxed frame. */
export const AttachmentItem = z.strictObject({
  id: z.string(),
  name: z.string(),
  contentType: z.string(),
  size: z.int().nonnegative(),
});
export type AttachmentItem = z.infer<typeof AttachmentItem>;

/** A public message of a Conversation. */
export const MessageItem = z.strictObject({
  id: z.string(),
  conversationId: z.string(),
  author: MessageAuthor,
  /**
   * The primary Bot's Session the message belongs to; the UI marks where a Session was renewed.
   * Events logged before Sessions could be renewed carry none.
   */
  sessionId: z.string().optional(),
  text: z.string(),
  // Events logged before Attachments existed carry no list.
  attachments: z.array(AttachmentItem).default([]),
  createdAt: epochMs,
});
export type MessageItem = z.infer<typeof MessageItem>;

export const MessagePage = z.strictObject({
  messages: z.array(MessageItem),
  nextCursor: z.string().optional(),
  /** Every Session of the Conversation, oldest first, closed ones included. */
  sessions: z.array(SessionItem),
  /**
   * Subscribe to the Conversation's events after this id. It points before any unfinished Run's
   * first event, so a reload replays that Run's stream; a message seen twice is the same id.
   */
  streamAfter: z.int().nonnegative(),
});
export type MessagePage = z.infer<typeof MessagePage>;

/**
 * A JSON body. With files the body is `multipart/form-data` instead: one `text` field, which may
 * be empty, and up to ATTACHMENTS_PER_MESSAGE_MAX `file` fields.
 */
export const PostMessageRequest = z.strictObject({
  text: z.string().trim().min(1).max(MESSAGE_TEXT_MAX),
});
export type PostMessageRequest = z.input<typeof PostMessageRequest>;

export const PostMessageResponse = z.strictObject({
  message: MessageItem,
  run: RunItem,
});
export type PostMessageResponse = z.infer<typeof PostMessageResponse>;
