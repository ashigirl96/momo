/**
 * The runner of P2. It lives in the backend's process and answers by fixed rules, but speaks only
 * the mailbox messages of ADR-0009, so P3 can put the sandbox runner in its place.
 */
import type { RunnerOutbound } from "@momo/contracts";

function proposedName(purpose: string): string {
  if (/slack|会社|仕事|定例|議事録/i.test(purpose)) return "仕事 Bot";
  if (/旅行/.test(purpose)) return "旅行 Bot";
  return "アシスタント Bot";
}

/** A new Bot proposes its own name and instructions from what the owner said it is for. */
export function proposeBotSettings(purpose: string): RunnerOutbound[] {
  const text = purpose.trim();
  return [
    {
      kind: "tool_request",
      requestId: `toolreq_${Bun.randomUUIDv7()}`,
      tool: {
        kind: "propose_bot_settings",
        proposal: { name: proposedName(text), instructions: `${text.slice(0, 60)} を手伝う` },
      },
    },
  ];
}
