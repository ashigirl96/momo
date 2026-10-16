import { afterEach, describe, expect, test } from "bun:test";
import {
  ApiError,
  BotItem,
  ConversationItem,
  MemoryItem,
  MemoryList,
  MessagePage,
  PostMessageResponse,
  RunItem,
  WorkspaceItem,
} from "@momo/contracts";
import { startTestBackend, type TestBackend } from "./testing.ts";

let b: TestBackend;
let cookie: string;

afterEach(async () => {
  await b.cleanup();
});

async function created<T>(res: Response, schema: { parse(v: unknown): T }): Promise<T> {
  expect(res.status).toBe(201);
  return schema.parse(await res.json());
}

async function workspace(name: string) {
  const w = await created(
    await b.call("/api/workspaces", { method: "POST", cookie, body: { name } }),
    WorkspaceItem,
  );
  return `/api/workspaces/${w.id}`;
}

async function bot(ws: string, name: string) {
  const body = { name, instructions: "手伝う", model: "sonnet", tools: ["memory"] };
  const item = await created(await b.call(`${ws}/bots`, { method: "POST", cookie, body }), BotItem);
  return { id: item.id, memory: `${ws}/bots/${item.id}/memory` };
}

async function conversation(ws: string, botId: string) {
  const res = await b.call(`${ws}/conversations`, { method: "POST", cookie, body: { primaryBotId: botId } });
  return (await created(res, ConversationItem)).id;
}

/** Sends a message and returns the Bot's reply once its Run has finished. */
async function say(ws: string, conversationId: string, text: string): Promise<string> {
  const base = `${ws}/conversations/${conversationId}`;
  const { run } = await created(
    await b.call(`${base}/messages`, { method: "POST", cookie, body: { text } }),
    PostMessageResponse,
  );
  for (let i = 0; i < 200; i++) {
    const current = RunItem.parse(await (await b.call(`${ws}/runs/${run.id}`, { cookie })).json());
    if (current.status !== "queued" && current.status !== "running") break;
    await Bun.sleep(10);
  }
  const page = MessagePage.parse(await (await b.call(`${base}/messages`, { cookie })).json());
  const reply = page.messages.findLast((m) => m.author.kind === "bot" && m.author.runId === run.id);
  return reply?.text ?? "";
}

async function list(memory: string): Promise<MemoryItem[]> {
  const res = await b.call(memory, { cookie });
  expect(res.status).toBe(200);
  return MemoryList.parse(await res.json()).items;
}

async function errorKind(res: Response): Promise<string> {
  return ApiError.parse(await res.json()).error.kind;
}

describe("a Bot's memory", () => {
  test("`remember:` writes a Memory item without approval, and another Conversation of the Bot finds it", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 0 });
    cookie = await b.login();
    const ws = await workspace("個人");
    const travel = await bot(ws, "旅行 Bot");
    const first = await conversation(ws, travel.id);

    expect(await say(ws, first, "remember: パスポートの期限は 2030 年 5 月")).toBe(
      "覚えました: パスポートの期限は 2030 年 5 月",
    );

    const [item] = await list(travel.memory);
    expect(item).toMatchObject({
      botId: travel.id,
      type: "note",
      title: "パスポートの期限は 2030 年 5 月",
      body: "パスポートの期限は 2030 年 5 月",
      tags: [],
      created: { writer: "bot", source: { kind: "conversation", conversationId: first } },
      updated: { writer: "bot", source: { kind: "conversation", conversationId: first } },
    });

    const second = await conversation(ws, travel.id);
    expect(await say(ws, second, "recall: パスポート")).toBe(
      "見つけた記憶:\n- パスポートの期限は 2030 年 5 月",
    );
    expect(await say(ws, second, "recall: 期限")).toBe("見つけた記憶:\n- パスポートの期限は 2030 年 5 月");
  });

  test("another Bot or Workspace never finds the item, even for the same words", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 0 });
    cookie = await b.login();
    const ws = await workspace("個人");
    const travel = await bot(ws, "旅行 Bot");
    const work = await bot(ws, "仕事 Bot");
    const otherWs = await workspace("会社 A");
    const otherBot = await bot(otherWs, "旅行 Bot");
    await say(ws, await conversation(ws, travel.id), "remember: 合言葉はさくら");

    expect(await say(ws, await conversation(ws, work.id), "recall: 合言葉")).toBe(
      "記憶は見つかりませんでした",
    );
    expect(await say(ws, await conversation(ws, work.id), "recall: 合")).toBe("記憶は見つかりませんでした");
    expect(await say(otherWs, await conversation(otherWs, otherBot.id), "recall: さくら")).toBe(
      "記憶は見つかりませんでした",
    );
    expect(await list(work.memory)).toEqual([]);
    expect(await list(otherBot.memory)).toEqual([]);
  });

  test("the owner deletes an item, and it is gone from the list and from search at once", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 0 });
    cookie = await b.login();
    const ws = await workspace("個人");
    const travel = await bot(ws, "旅行 Bot");
    const talk = await conversation(ws, travel.id);
    await say(ws, talk, "remember: 消す合言葉はもみじ");
    await say(ws, talk, "remember: 残す合言葉はかえで");
    const doomed = (await list(travel.memory)).find((i) => i.body.includes("もみじ"))!;

    const res = await b.call(`${travel.memory}/${doomed.id}`, { method: "DELETE", cookie });
    expect(res.status).toBe(204);

    expect((await list(travel.memory)).map((i) => i.body)).toEqual(["残す合言葉はかえで"]);
    expect((await b.call(`${travel.memory}/${doomed.id}`, { cookie })).status).toBe(404);
    expect(await say(ws, talk, "recall: もみじ")).toBe("記憶は見つかりませんでした");
    expect(await say(ws, talk, "recall: 合言葉")).toBe("見つけた記憶:\n- 残す合言葉はかえで");
  });

  test("an item id under another Bot or Workspace is not found, and deleting it there removes nothing", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 0 });
    cookie = await b.login();
    const ws = await workspace("個人");
    const travel = await bot(ws, "旅行 Bot");
    const work = await bot(ws, "仕事 Bot");
    const otherWs = await workspace("会社 A");
    const otherBot = await bot(otherWs, "仕事 Bot");
    await say(ws, await conversation(ws, travel.id), "remember: 守る記憶");
    const [item] = await list(travel.memory);

    expect((await b.call(`${travel.memory}/${item!.id}`, { cookie })).status).toBe(200);
    for (const path of [
      `${work.memory}/${item!.id}`,
      `${otherBot.memory}/${item!.id}`,
      `${otherWs}/bots/${travel.id}/memory/${item!.id}`,
    ]) {
      const read = await b.call(path, { cookie });
      expect(read.status).toBe(404);
      expect(await errorKind(read)).toBe("not_found");
      expect((await b.call(path, { method: "DELETE", cookie })).status).toBe(404);
    }
    expect((await b.call(`${otherWs}/bots/${travel.id}/memory`, { cookie })).status).toBe(404);
    expect((await list(travel.memory)).map((i) => i.id)).toEqual([item!.id]);
  });

  test("a list cursor of another Bot or Workspace is refused", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 0 });
    cookie = await b.login();
    const ws = await workspace("個人");
    const travel = await bot(ws, "旅行 Bot");
    const work = await bot(ws, "仕事 Bot");
    const talk = await conversation(ws, travel.id);
    await say(ws, talk, "remember: 一つ目");
    await say(ws, talk, "remember: 二つ目");
    const page = MemoryList.parse(await (await b.call(`${travel.memory}?limit=1`, { cookie })).json());
    expect(page.items.map((i) => i.body)).toEqual(["二つ目"]);

    const next = MemoryList.parse(
      await (await b.call(`${travel.memory}?limit=1&cursor=${page.nextCursor}`, { cookie })).json(),
    );
    expect(next.items.map((i) => i.body)).toEqual(["一つ目"]);
    const res = await b.call(`${work.memory}?cursor=${page.nextCursor}`, { cookie });
    expect(res.status).toBe(400);
    expect(await errorKind(res)).toBe("bad_request");
  });

  test("Memory items survive a restart", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 0 });
    cookie = await b.login();
    const ws = await workspace("個人");
    const travel = await bot(ws, "旅行 Bot");
    await say(ws, await conversation(ws, travel.id), "remember: 再起動のあとも覚えている");

    b = await b.restart({ fakeRunnerDelayMs: 0 });

    expect((await list(travel.memory)).map((i) => i.body)).toEqual(["再起動のあとも覚えている"]);
    expect(await say(ws, await conversation(ws, travel.id), "recall: 再起動")).toBe(
      "見つけた記憶:\n- 再起動のあとも覚えている",
    );
  });
});
