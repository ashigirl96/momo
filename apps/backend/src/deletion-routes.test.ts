import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import {
  ApiError,
  BotItem,
  ConversationItem,
  ConversationList,
  DeletionPreview,
  MemoryList,
  MessagePage,
  PostMessageResponse,
  RunItem,
  WorkspaceItem,
  WorkspaceList,
} from "@momo/contracts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startTestBackend, type TestBackend } from "./testing.ts";

let b: TestBackend;
let cookie: string;

afterEach(async () => {
  await b.cleanup();
});

async function start(fakeRunnerDelayMs = 0) {
  b = await startTestBackend({ fakeRunnerDelayMs });
  cookie = await b.login();
}

async function created<T>(res: Response, schema: { parse(v: unknown): T }): Promise<T> {
  expect(res.status).toBe(201);
  return schema.parse(await res.json());
}

async function workspace(name: string) {
  const w = await created(
    await b.call("/api/workspaces", { method: "POST", cookie, body: { name } }),
    WorkspaceItem,
  );
  return { id: w.id, path: `/api/workspaces/${w.id}` };
}

async function bot(ws: string, name: string) {
  const body = { name, instructions: "手伝う", model: "sonnet", tools: ["memory"] };
  return (await created(await b.call(`${ws}/bots`, { method: "POST", cookie, body }), BotItem)).id;
}

async function conversation(ws: string, botId: string) {
  const res = await b.call(`${ws}/conversations`, { method: "POST", cookie, body: { primaryBotId: botId } });
  return (await created(res, ConversationItem)).id;
}

async function post(ws: string, conversationId: string, text: string, file?: File) {
  const path = `${ws}/conversations/${conversationId}/messages`;
  const init = file ? { form: formWith(text, file) } : { body: { text } };
  return (await created(await b.call(path, { method: "POST", cookie, ...init }), PostMessageResponse)).run;
}

function formWith(text: string, file: File): FormData {
  const form = new FormData();
  form.set("text", text);
  form.append("file", file);
  return form;
}

async function runStatus(ws: string, runId: string) {
  return RunItem.parse(await (await b.call(`${ws}/runs/${runId}`, { cookie })).json()).status;
}

async function waitFor(ws: string, runId: string, done: (status: string) => boolean) {
  for (let i = 0; i < 300; i++) {
    if (done(await runStatus(ws, runId))) return;
    await Bun.sleep(10);
  }
  throw new Error(`run ${runId} did not get there`);
}

const finished = (s: string) => s !== "queued" && s !== "running";

async function say(ws: string, conversationId: string, text: string, file?: File) {
  const run = await post(ws, conversationId, text, file);
  await waitFor(ws, run.id, finished);
  return run;
}

async function errorKind(res: Response): Promise<string> {
  return ApiError.parse(await res.json()).error.kind;
}

async function conversationIds(ws: string): Promise<string[]> {
  const res = await b.call(`${ws}/conversations`, { cookie });
  return ConversationList.parse(await res.json()).conversations.map((c) => c.id);
}

function attachmentFiles(workspaceId: string): string[] {
  const dir = join(b.dataDir, "attachments", workspaceId);
  return existsSync(dir) ? readdirSync(dir) : [];
}

function scanAppDb(needle: string): number {
  const path = join(b.dataDir, "app.db");
  const other = new Database(path);
  other.run("PRAGMA wal_checkpoint(TRUNCATE)");
  other.close();
  const bytes = Buffer.from(needle);
  let hits = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    if (!existsSync(`${path}${suffix}`)) continue;
    const content = readFileSync(`${path}${suffix}`);
    for (let at = content.indexOf(bytes); at !== -1; at = content.indexOf(bytes, at + 1)) hits++;
  }
  return hits;
}

describe("DELETE /api/workspaces/:id", () => {
  test("shows how many Conversations go, then deletes the Workspace with its Bots, Conversations, Memory and Attachments", async () => {
    await start();
    const personal = await workspace("個人");
    const work = await workspace("会社");
    const travel = await bot(personal.path, "旅行 Bot");
    const first = await conversation(personal.path, travel);
    await conversation(personal.path, travel);
    await say(personal.path, first, "remember: パスポートは青い鞄", new File(["地図"], "map.txt"));
    const kept = await bot(work.path, "仕事 Bot");
    const keptConversation = await conversation(work.path, kept);
    await say(work.path, keptConversation, "remember: 会議は月曜");

    const preview = await b.call(`${personal.path}/deletion-preview`, { cookie });
    expect(DeletionPreview.parse(await preview.json())).toEqual({ conversations: 2 });
    expect(attachmentFiles(personal.id)).toHaveLength(1);

    const res = await b.call(personal.path, { method: "DELETE", cookie });
    expect(res.status).toBe(204);

    expect((await b.call(personal.path, { cookie })).status).toBe(404);
    expect((await b.call(`${personal.path}/bots/${travel}`, { cookie })).status).toBe(404);
    const list = WorkspaceList.parse(await (await b.call("/api/workspaces", { cookie })).json());
    expect(list.workspaces.map((w) => w.id)).toEqual([work.id]);
    expect(existsSync(join(b.dataDir, "attachments", personal.id))).toBe(false);

    expect(await conversationIds(work.path)).toEqual([keptConversation]);
    const memory = MemoryList.parse(
      await (await b.call(`${work.path}/bots/${kept}/memory`, { cookie })).json(),
    );
    expect(memory.items.map((m) => m.body)).toEqual(["会議は月曜"]);
  });

  test("leaves none of the Workspace's text in app.db or its full-text index", async () => {
    await start();
    const secret = "QWX-青い鞄の秘密-4417";
    const personal = await workspace(`${secret} 個人`);
    const travel = await bot(personal.path, `${secret} Bot`);
    const c = await conversation(personal.path, travel);
    await say(personal.path, c, `remember: ${secret}`, new File([secret], `${secret}.txt`));
    const work = await workspace("会社");
    const kept = await bot(work.path, "仕事 Bot");
    await say(work.path, await conversation(work.path, kept), "remember: JKV-残る記憶");
    expect(scanAppDb(secret)).toBeGreaterThan(0);
    expect(scanAppDb("qwx")).toBeGreaterThan(0);

    expect((await b.call(personal.path, { method: "DELETE", cookie })).status).toBe(204);

    expect(scanAppDb(secret)).toBe(0);
    expect(scanAppDb("qwx")).toBe(0);
    expect(scanAppDb(personal.id)).toBe(0);
    expect(scanAppDb("JKV-残る記憶")).toBeGreaterThan(0);
  });

  test("stops a Run that is still streaming and keeps the other Workspace working", async () => {
    await start(30);
    const personal = await workspace("個人");
    const c = await conversation(personal.path, await bot(personal.path, "旅行 Bot"));
    const run = await post(personal.path, c, "長い返事をください。長い返事をください。");
    await waitFor(personal.path, run.id, (s) => s === "running");

    expect((await b.call(personal.path, { method: "DELETE", cookie })).status).toBe(204);
    await Bun.sleep(150);

    const work = await workspace("会社");
    const wc = await conversation(work.path, await bot(work.path, "仕事 Bot"));
    const reply = await say(work.path, wc, "こんにちは");
    expect(await runStatus(work.path, reply.id)).toBe("completed");
    const page = MessagePage.parse(
      await (await b.call(`${work.path}/conversations/${wc}/messages`, { cookie })).json(),
    );
    expect(page.messages.map((m) => m.author.kind)).toEqual(["owner", "bot"]);
  });

  test("needs a Login and a same-origin page", async () => {
    await start();
    const personal = await workspace("個人");

    expect((await b.call(personal.path, { method: "DELETE" })).status).toBe(401);
    const forged = await b.call(personal.path, {
      method: "DELETE",
      cookie,
      headers: { origin: "http://evil.example", "sec-fetch-site": "cross-site" },
    });
    expect(forged.status).toBe(403);
    expect((await b.call(personal.path, { cookie })).status).toBe(200);
  });
});

describe("DELETE /api/workspaces/:id/bots/:botId", () => {
  test("deletes the Bot, its Memory and the Conversations it leads, and nothing of the other Bots", async () => {
    await start();
    const ws = await workspace("個人");
    const travel = await bot(ws.path, "旅行 Bot");
    const led = await conversation(ws.path, travel);
    await say(ws.path, led, "remember: パスポートは青い鞄", new File(["地図"], "map.txt"));
    const other = await bot(ws.path, "料理 Bot");
    const kept = await conversation(ws.path, other);
    await say(ws.path, kept, "remember: 塩は少なめ");

    const preview = await b.call(`${ws.path}/bots/${travel}/deletion-preview`, { cookie });
    expect(DeletionPreview.parse(await preview.json())).toEqual({ conversations: 1 });

    expect((await b.call(`${ws.path}/bots/${travel}`, { method: "DELETE", cookie })).status).toBe(204);

    expect((await b.call(`${ws.path}/bots/${travel}`, { cookie })).status).toBe(404);
    expect((await b.call(`${ws.path}/bots/${travel}/memory`, { cookie })).status).toBe(404);
    expect((await b.call(`${ws.path}/conversations/${led}`, { cookie })).status).toBe(404);
    expect(await conversationIds(ws.path)).toEqual([kept]);
    expect(attachmentFiles(ws.id)).toEqual([]);
    const memory = MemoryList.parse(
      await (await b.call(`${ws.path}/bots/${other}/memory`, { cookie })).json(),
    );
    expect(memory.items.map((m) => m.body)).toEqual(["塩は少なめ"]);
    expect((await b.call(`${ws.path}/bots/${travel}`, { method: "DELETE", cookie })).status).toBe(404);
  });

  test("refuses another Workspace's Bot id and deletes nothing", async () => {
    await start();
    const personal = await workspace("個人");
    const work = await workspace("会社");
    const theirs = await bot(work.path, "仕事 Bot");
    const theirConversation = await conversation(work.path, theirs);
    await say(work.path, theirConversation, "remember: 会議は月曜", new File(["議事録"], "notes.txt"));

    const preview = await b.call(`${personal.path}/bots/${theirs}/deletion-preview`, { cookie });
    expect(preview.status).toBe(404);
    const res = await b.call(`${personal.path}/bots/${theirs}`, { method: "DELETE", cookie });
    expect(res.status).toBe(404);
    expect(await errorKind(res)).toBe("not_found");

    expect((await b.call(`${work.path}/bots/${theirs}`, { cookie })).status).toBe(200);
    expect(await conversationIds(work.path)).toEqual([theirConversation]);
    const memory = MemoryList.parse(
      await (await b.call(`${work.path}/bots/${theirs}/memory`, { cookie })).json(),
    );
    expect(memory.items).toHaveLength(1);
    expect(attachmentFiles(work.id)).toHaveLength(1);
  });
});
