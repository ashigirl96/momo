/** Built through the real API, so every row comes from the real routes and migrations. */
import {
  BotItem,
  ConversationItem,
  MemoryList,
  MessagePage,
  PostMessageResponse,
  RunItem,
  WorkspaceItem,
  type ConversationEvent,
} from "@momo/contracts";
import { expect } from "bun:test";
import type { TestBackend } from "./testing.ts";

export type GateConversation = {
  workspaceId: string;
  botId: string;
  id: string;
  base: string;
  /** Unique to this Conversation; it is in its message, Attachment and Memory item. */
  secret: string;
  attachmentId: string;
  attachmentText: string;
  sessionIds: string[];
  runIds: string[];
};

export type GateBot = {
  workspaceId: string;
  id: string;
  conversations: GateConversation[];
  memoryItemIds: string[];
};

export type GateWorkspace = { id: string; path: string; bots: GateBot[] };

export type GateFixture = {
  workspaces: GateWorkspace[];
  bots: GateBot[];
  conversations: GateConversation[];
};

/** Every Memory item's body has these, so one search would find all of them without scoping. */
export const SHARED_TERM = "共通メモ";
/** Shorter than a trigram, so the search takes its LIKE path. */
export const SHARED_SHORT_TERM = "zq";

export type Frame = { id: number; event: ConversationEvent };

export class Api {
  constructor(
    public b: TestBackend,
    public cookie: string,
  ) {}

  call(path: string, init: Parameters<TestBackend["call"]>[1] = {}) {
    return this.b.call(path, { cookie: this.cookie, ...init });
  }

  async created<T>(res: Response, schema: { parse(v: unknown): T }): Promise<T> {
    expect(res.status).toBe(201);
    return schema.parse(await res.json());
  }

  async ok<T>(path: string, schema: { parse(v: unknown): T }): Promise<T> {
    const res = await this.call(path);
    expect([path, res.status]).toEqual([path, 200]);
    return schema.parse(await res.json());
  }

  async waitForRun(workspacePath: string, runId: string): Promise<RunItem> {
    for (let i = 0; i < 500; i++) {
      const run = await this.ok(`${workspacePath}/runs/${runId}`, RunItem);
      if (run.status !== "queued" && run.status !== "running") return run;
      await Bun.sleep(5);
    }
    throw new Error(`Run ${runId} did not finish`);
  }

  async say(workspacePath: string, base: string, text: string, files: File[] = []) {
    const form = new FormData();
    form.set("text", text);
    for (const file of files) form.append("file", file);
    const posted = await this.created(
      await this.call(`${base}/messages`, { method: "POST", form }),
      PostMessageResponse,
    );
    await this.waitForRun(workspacePath, posted.run.id);
    const page = await this.ok(`${base}/messages`, MessagePage);
    const reply = page.messages.findLast((m) => m.author.kind === "bot" && m.author.runId === posted.run.id);
    return { ...posted, reply: reply?.text ?? "" };
  }
}

export async function frames(
  res: Response,
  until: (frame: Frame) => boolean = () => false,
  timeoutMs = 3000,
): Promise<{ frames: Frame[]; ended: boolean }> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const out: Frame[] = [];
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(deadline - Date.now()).then(() => undefined),
      ]);
      if (!chunk) break;
      if (chunk.done) return { frames: out, ended: true };
      buffer += chunk.value;
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const id = /^id: (\d+)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (id === undefined || data === undefined) continue;
        const frame = { id: Number(id), event: JSON.parse(data) as ConversationEvent };
        out.push(frame);
        if (until(frame)) return { frames: out, ended: false };
      }
    }
    return { frames: out, ended: false };
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export const finished = (runId: string) => (f: Frame) =>
  f.event.kind === "run_finished" && f.event.runId === runId;

/** The second Conversation of each Bot is reset and talked to again, so it has a closed and an open Session. */
export async function buildGateFixture(api: Api): Promise<GateFixture> {
  const workspaces: GateWorkspace[] = [];
  for (const w of [0, 1]) {
    const item = await api.created(
      await api.call("/api/workspaces", { method: "POST", body: { name: `W${w}` } }),
      WorkspaceItem,
    );
    const path = `/api/workspaces/${item.id}`;
    const bots: GateBot[] = [];
    for (const k of [0, 1]) {
      const bot = await api.created(
        await api.call(`${path}/bots`, {
          method: "POST",
          body: { name: `W${w} Bot${k}`, instructions: "手伝う", model: "sonnet", tools: ["memory"] },
        }),
        BotItem,
      );
      const conversations: GateConversation[] = [];
      for (const c of [0, 1]) {
        const conversation = await api.created(
          await api.call(`${path}/conversations`, { method: "POST", body: { primaryBotId: bot.id } }),
          ConversationItem,
        );
        const base = `${path}/conversations/${conversation.id}`;
        const secret = `秘密-w${w}b${k}c${c}`;
        const attachmentText = `中身-w${w}b${k}c${c}`;
        const runIds: string[] = [];
        const first = await api.say(path, base, `remember: ${SHARED_TERM} ${SHARED_SHORT_TERM} ${secret}`, [
          new File([attachmentText], `${secret}.txt`, { type: "text/plain" }),
        ]);
        expect(first.reply).toStartWith("覚えました");
        runIds.push(first.run.id);
        if (c === 1) {
          expect((await api.call(`${base}/reset`, { method: "POST" })).status).toBe(200);
          runIds.push((await api.say(path, base, `続き ${secret}`)).run.id);
        }
        const page = await api.ok(`${base}/messages`, MessagePage);
        conversations.push({
          workspaceId: item.id,
          botId: bot.id,
          id: conversation.id,
          base,
          secret,
          attachmentId: first.message.attachments[0]!.id,
          attachmentText,
          sessionIds: page.sessions.map((s) => s.id),
          runIds,
        });
      }
      const memory = await api.ok(`${path}/bots/${bot.id}/memory`, MemoryList);
      bots.push({
        workspaceId: item.id,
        id: bot.id,
        conversations,
        memoryItemIds: memory.items.map((i) => i.id),
      });
    }
    workspaces.push({ id: item.id, path, bots });
  }
  const bots = workspaces.flatMap((w) => w.bots);
  return { workspaces, bots, conversations: bots.flatMap((bot) => bot.conversations) };
}
