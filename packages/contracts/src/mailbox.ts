/** The backend takes the Workspace, Bot and Session from the mailbox a message arrived on, never from the message (ADR-0009). */
import { z } from "zod";
import { BotSettingsProposal } from "./bots.ts";
import { MEMORY_QUERY_MAX, MemoryHit, MemoryItemDraft } from "./memory.ts";

const id = z.string().min(1).max(200);

/** The memory tools act on the Bot of the Run they arrive in. */
export const ToolRequest = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("propose_bot_settings"), proposal: BotSettingsProposal }),
  z.strictObject({ kind: z.literal("memory_write"), item: MemoryItemDraft }),
  z.strictObject({
    kind: z.literal("memory_search"),
    query: z.string().trim().min(1).max(MEMORY_QUERY_MAX),
  }),
]);
export type ToolRequest = z.infer<typeof ToolRequest>;

export const ToolErrorKind = z.enum(["not_in_run", "invalid_request", "failed"]);
export type ToolErrorKind = z.infer<typeof ToolErrorKind>;

export const ToolResult = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("error"), error: ToolErrorKind, message: z.string() }),
  z.strictObject({ kind: z.literal("memory_written"), id }),
  z.strictObject({ kind: z.literal("memory_found"), items: z.array(MemoryHit) }),
]);
export type ToolResult = z.infer<typeof ToolResult>;

export const RunInputMessage = z.strictObject({
  author: z.enum(["owner", "bot"]),
  text: z.string(),
});
export type RunInputMessage = z.infer<typeof RunInputMessage>;

export const RunOutcome = z.enum(["completed", "failed", "cancelled"]);
export type RunOutcome = z.infer<typeof RunOutcome>;

export const RunnerInbound = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("run_start"),
    runId: id,
    input: z.string(),
    history: z.array(RunInputMessage),
  }),
  z.strictObject({ kind: z.literal("tool_result"), runId: id, requestId: id, result: ToolResult }),
  z.strictObject({ kind: z.literal("cancel"), runId: id }),
]);
export type RunnerInbound = z.infer<typeof RunnerInbound>;

/** A tool request without `runId` comes from outside a Run. */
export const RunnerOutbound = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("stream_delta"), runId: id, text: z.string().min(1).max(4000) }),
  z.strictObject({ kind: z.literal("tool_request"), runId: id.optional(), requestId: id, tool: ToolRequest }),
  z.strictObject({ kind: z.literal("run_finished"), runId: id, outcome: RunOutcome }),
]);
export type RunnerOutbound = z.infer<typeof RunnerOutbound>;
