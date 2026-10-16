/**
 * Messages between the backend and a runner (ADR-0009). The runner writes only outbound
 * messages and the backend validates each one here before acting on it.
 */
import { z } from "zod";
import { BotSettingsProposal } from "./bots.ts";

export const ToolRequest = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("propose_bot_settings"), proposal: BotSettingsProposal }),
]);
export type ToolRequest = z.infer<typeof ToolRequest>;

export const RunnerOutbound = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("tool_request"), requestId: z.string().min(1), tool: ToolRequest }),
]);
export type RunnerOutbound = z.infer<typeof RunnerOutbound>;
