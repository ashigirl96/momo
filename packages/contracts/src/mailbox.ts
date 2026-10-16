/**
 * Messages between the backend and a runner (ADR-0009). Each Session has one mailbox: the backend
 * writes only inbound messages and the runner writes only outbound ones. The backend validates
 * every outbound message here before acting on it, and takes the Workspace, Bot and Session from
 * the mailbox the message arrived on, never from the message.
 */
import { z } from "zod";
import { BotSettingsProposal } from "./bots.ts";

const id = z.string().min(1).max(200);

/** What a runner asks the backend to do. #44 adds the memory tool here. */
export const ToolRequest = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("propose_bot_settings"), proposal: BotSettingsProposal }),
]);
export type ToolRequest = z.infer<typeof ToolRequest>;

export const ToolErrorKind = z.enum(["not_in_run", "invalid_request", "failed"]);
export type ToolErrorKind = z.infer<typeof ToolErrorKind>;

/** What the backend answers a tool request with. #44 adds the memory tool's results here. */
export const ToolResult = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("error"), error: ToolErrorKind, message: z.string() }),
]);
export type ToolResult = z.infer<typeof ToolResult>;

/** The public messages of the Conversation a Run answers, oldest first. */
export const RunInputMessage = z.strictObject({
  author: z.enum(["owner", "bot"]),
  text: z.string(),
});
export type RunInputMessage = z.infer<typeof RunInputMessage>;

export const RunOutcome = z.enum(["completed", "failed", "cancelled"]);
export type RunOutcome = z.infer<typeof RunOutcome>;

/** Backend → runner. */
export const RunnerInbound = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("run_start"),
    runId: id,
    /** The text the Run answers. */
    input: z.string(),
    history: z.array(RunInputMessage),
  }),
  z.strictObject({ kind: z.literal("tool_result"), runId: id, requestId: id, result: ToolResult }),
  z.strictObject({ kind: z.literal("cancel"), runId: id }),
]);
export type RunnerInbound = z.infer<typeof RunnerInbound>;

/** Runner → backend. A tool request without `runId` comes from outside a Run (the Bot settings proposal). */
export const RunnerOutbound = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("stream_delta"), runId: id, text: z.string().min(1).max(4000) }),
  z.strictObject({ kind: z.literal("tool_request"), runId: id.optional(), requestId: id, tool: ToolRequest }),
  z.strictObject({ kind: z.literal("run_finished"), runId: id, outcome: RunOutcome }),
]);
export type RunnerOutbound = z.infer<typeof RunnerOutbound>;
