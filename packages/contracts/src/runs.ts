import { z } from "zod";

const epochMs = z.int().nonnegative();

/**
 * queued → running → completed | failed | cancelled. A Session runs one Run at a time;
 * a Run left running when the backend stopped is failed on the next start.
 */
export const RunStatus = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const FINISHED_RUN_STATUSES = ["completed", "failed", "cancelled"] as const satisfies RunStatus[];

export const RunItem = z.strictObject({
  id: z.string(),
  conversationId: z.string(),
  sessionId: z.string(),
  botId: z.string(),
  status: RunStatus,
  createdAt: epochMs,
});
export type RunItem = z.infer<typeof RunItem>;
