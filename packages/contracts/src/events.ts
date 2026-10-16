/** Ids grow across the whole app.db, so a resume sends the last id it saw as `Last-Event-ID`. */
import { z } from "zod";
import { MessageItem } from "./messages.ts";
import { RunItem, RunStatus } from "./runs.ts";
import { SessionItem } from "./sessions.ts";

export const ConversationEvent = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("message_created"), message: MessageItem }),
  z.strictObject({ kind: z.literal("run_queued"), run: RunItem }),
  z.strictObject({ kind: z.literal("run_started"), runId: z.string() }),
  z.strictObject({ kind: z.literal("run_delta"), runId: z.string(), text: z.string() }),
  z.strictObject({ kind: z.literal("run_finished"), runId: z.string(), status: RunStatus }),
  z.strictObject({ kind: z.literal("session_closed"), session: SessionItem }),
]);
export type ConversationEvent = z.infer<typeof ConversationEvent>;
