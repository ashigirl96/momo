/**
 * The runner of P2. It lives in the backend's process and answers by fixed rules, but speaks only
 * the mailbox messages of ADR-0009, so P3 can put the sandbox runner in its place.
 */
import { RunnerInbound, type RunInputMessage, type RunnerOutbound } from "@momo/contracts";
import type { Runner, SessionMailbox } from "./mailbox.ts";

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

/** What the fake runner answers; Markdown, so the UI's sanitized rendering is exercised. */
export function fakeReply(input: string, history: RunInputMessage[]): string {
  const count = history.filter((m) => m.author === "owner").length + 1;
  return `**${count} 件目**の発言を受け取りました: ${input}`;
}

const CHUNK = 4;

function chunks(text: string): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += CHUNK) out.push(chars.slice(i, i + CHUNK).join(""));
  return out;
}

export class FakeRunner implements Runner {
  readonly #delayMs: number;
  readonly #timers = new Set<Timer>();
  readonly #cancelled = new Set<string>();
  #stopped = false;

  constructor(options: { delayMs: number }) {
    this.#delayMs = options.delayMs;
  }

  attach(mailbox: SessionMailbox): void {
    mailbox.onInbound((raw) => {
      const parsed = RunnerInbound.safeParse(raw);
      if (!parsed.success || this.#stopped) return;
      const message = parsed.data;
      if (message.kind === "run_start")
        this.#run(mailbox, message.runId, fakeReply(message.input, message.history));
      if (message.kind === "cancel") this.#cancelled.add(message.runId);
    });
  }

  stop(): void {
    this.#stopped = true;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }

  #run(mailbox: SessionMailbox, runId: string, reply: string): void {
    const pieces = chunks(reply);
    const step = (index: number) => {
      if (this.#stopped) return;
      if (this.#cancelled.delete(runId)) {
        mailbox.postOutbound({ kind: "run_finished", runId, outcome: "cancelled" } satisfies RunnerOutbound);
        return;
      }
      const piece = pieces[index];
      if (piece === undefined) {
        mailbox.postOutbound({ kind: "run_finished", runId, outcome: "completed" } satisfies RunnerOutbound);
        return;
      }
      mailbox.postOutbound({ kind: "stream_delta", runId, text: piece } satisfies RunnerOutbound);
      this.#later(() => step(index + 1));
    };
    this.#later(() => step(0));
  }

  #later(fn: () => void): void {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      fn();
    }, this.#delayMs);
    this.#timers.add(timer);
  }
}
