/** Speaks only the ADR-0009 mailbox messages, so another runner can take its place. */
import {
  RunnerInbound,
  type RunInputMessage,
  type RunnerOutbound,
  type ToolRequest,
  type ToolResult,
} from "@momo/contracts";
import type { Runner, SessionMailbox } from "./mailbox.ts";

function proposedName(purpose: string): string {
  if (/slack|会社|仕事|定例|議事録/i.test(purpose)) return "仕事 Bot";
  if (/旅行/.test(purpose)) return "旅行 Bot";
  return "アシスタント Bot";
}

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

/** Markdown, so the UI's sanitized rendering is exercised. */
export function fakeReply(input: string, history: RunInputMessage[]): string {
  const count = history.filter((m) => m.author === "owner").length + 1;
  return `**${count} 件目**の発言を受け取りました: ${input}`;
}

const REMEMBER = /^remember:\s*(\S[\s\S]*)$/;
const RECALL = /^recall:\s*(\S[\s\S]*)$/;
const TITLE_MAX = 40;

/** The memory tool a message asks for: `remember: <本文>` writes, `recall: <語>` searches. */
export function memoryToolFor(input: string): ToolRequest | undefined {
  const text = input.trim();
  const remember = REMEMBER.exec(text)?.[1]?.trim();
  if (remember) {
    const title = Array.from(remember.split("\n")[0]!).slice(0, TITLE_MAX).join("").trim();
    return {
      kind: "memory_write",
      item: { type: "note", title, description: "", tags: [], body: remember },
    };
  }
  const recall = RECALL.exec(text)?.[1]?.trim();
  if (recall) return { kind: "memory_search", query: recall };
  return undefined;
}

function replyToToolResult(request: ToolRequest, result: ToolResult): string {
  if (result.kind === "error") return `記憶の tool が失敗しました: ${result.message}`;
  if (result.kind === "memory_found") {
    if (result.items.length === 0) return "記憶は見つかりませんでした";
    return ["見つけた記憶:", ...result.items.map((item) => `- ${item.body}`)].join("\n");
  }
  return `覚えました: ${request.kind === "memory_write" ? request.item.title : ""}`;
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
  readonly #waiting = new Map<string, { runId: string; answer: (result: ToolResult) => void }>();
  #stopped = false;

  constructor(options: { delayMs: number }) {
    this.#delayMs = options.delayMs;
  }

  attach(mailbox: SessionMailbox): void {
    mailbox.onInbound((raw) => {
      const parsed = RunnerInbound.safeParse(raw);
      if (!parsed.success || this.#stopped) return;
      const message = parsed.data;
      if (message.kind === "run_start") this.#start(mailbox, message);
      if (message.kind === "cancel") this.#cancelled.add(message.runId);
      if (message.kind === "tool_result") {
        const waiting = this.#waiting.get(message.requestId);
        if (waiting?.runId !== message.runId) return;
        this.#waiting.delete(message.requestId);
        waiting.answer(message.result);
      }
    });
  }

  stop(): void {
    this.#stopped = true;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }

  #start(mailbox: SessionMailbox, start: Extract<RunnerInbound, { kind: "run_start" }>): void {
    const tool = memoryToolFor(start.input);
    if (!tool) {
      this.#run(mailbox, start.runId, fakeReply(start.input, start.history));
      return;
    }
    const requestId = `toolreq_${Bun.randomUUIDv7()}`;
    this.#waiting.set(requestId, {
      runId: start.runId,
      answer: (result) => this.#run(mailbox, start.runId, replyToToolResult(tool, result)),
    });
    mailbox.postOutbound({
      kind: "tool_request",
      runId: start.runId,
      requestId,
      tool,
    } satisfies RunnerOutbound);
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
