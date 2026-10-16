import { afterEach, describe, expect, test } from "bun:test";
import {
  ApiError,
  BotItem,
  BotList,
  BotSettingsProposal,
  WorkspaceItem,
  type CreateBotRequest,
} from "@momo/contracts";
import { startTestBackend, type TestBackend } from "./testing.ts";

let b: TestBackend;

afterEach(async () => {
  await b.cleanup();
});

const settings = {
  name: "仕事 Bot",
  instructions: "定例の議事録を手伝う",
  model: "sonnet",
  tools: ["memory"],
} satisfies CreateBotRequest;

async function workspace(cookie: string, name: string): Promise<WorkspaceItem> {
  const res = await b.call("/api/workspaces", { method: "POST", cookie, body: { name } });
  return WorkspaceItem.parse(await res.json());
}

async function propose(cookie: string, workspaceId: string, purpose: string): Promise<BotSettingsProposal> {
  const res = await b.call(`/api/workspaces/${workspaceId}/bot-proposals`, {
    method: "POST",
    cookie,
    body: { purpose },
  });
  expect(res.status).toBe(200);
  return BotSettingsProposal.parse(await res.json());
}

async function createBot(
  cookie: string,
  workspaceId: string,
  body: CreateBotRequest = settings,
): Promise<BotItem> {
  const res = await b.call(`/api/workspaces/${workspaceId}/bots`, { method: "POST", cookie, body });
  expect(res.status).toBe(201);
  return BotItem.parse(await res.json());
}

async function botNames(cookie: string, workspaceId: string): Promise<string[]> {
  const res = await b.call(`/api/workspaces/${workspaceId}/bots`, { cookie });
  return BotList.parse(await res.json()).bots.map((bot) => bot.name);
}

async function errorKind(res: Response): Promise<string> {
  return ApiError.parse(await res.json()).error.kind;
}

describe("Bot settings proposal", () => {
  test("the fake runner proposes a fixed name and instructions for the purpose", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const w = await workspace(cookie, "個人");

    expect(await propose(cookie, w.id, "会社の定例の議事録をまとめたい")).toEqual({
      name: "仕事 Bot",
      instructions: "会社の定例の議事録をまとめたい を手伝う",
    });
    expect(await propose(cookie, w.id, "  旅行の計画  ")).toEqual({
      name: "旅行 Bot",
      instructions: "旅行の計画 を手伝う",
    });
    expect((await propose(cookie, w.id, "料理")).name).toBe("アシスタント Bot");
  });

  test("a proposal creates no Bot until the owner saves it", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const w = await workspace(cookie, "個人");

    await propose(cookie, w.id, "旅行の計画");
    expect(await botNames(cookie, w.id)).toEqual([]);
  });

  test("an empty or overlong purpose, or one naming a Workspace, is refused", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const w = await workspace(cookie, "個人");

    for (const body of [
      { purpose: " " },
      { purpose: "x".repeat(501) },
      { purpose: "x", workspaceId: w.id },
    ]) {
      const res = await b.call(`/api/workspaces/${w.id}/bot-proposals`, { method: "POST", cookie, body });
      expect(res.status).toBe(400);
    }
  });
});

describe("Bot API", () => {
  test("a saved Bot is listed newest first with its model and tools, and survives a restart", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const w = await workspace(cookie, "個人");

    const proposal = await propose(cookie, w.id, "旅行の計画");
    const travel = await createBot(cookie, w.id, { ...proposal, model: "opus", tools: [] });
    const work = await createBot(cookie, w.id);
    expect(travel).toMatchObject({
      name: "旅行 Bot",
      instructions: "旅行の計画 を手伝う",
      model: "opus",
      tools: [],
    });

    b = await b.restart();
    const res = await b.call(`/api/workspaces/${w.id}/bots`, { cookie });
    expect(BotList.parse(await res.json()).bots).toEqual([work, travel]);
    const opened = await b.call(`/api/workspaces/${w.id}/bots/${travel.id}`, { cookie });
    expect(BotItem.parse(await opened.json())).toEqual(travel);
  });

  test("model and tool settings can be changed and are shown back", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const w = await workspace(cookie, "個人");
    const bot = await createBot(cookie, w.id);

    const res = await b.call(`/api/workspaces/${w.id}/bots/${bot.id}`, {
      method: "PATCH",
      cookie,
      body: { model: "haiku", tools: [] },
    });
    expect(res.status).toBe(200);
    expect(BotItem.parse(await res.json())).toEqual({ ...bot, model: "haiku", tools: [] });
  });

  test("a create request naming an id or Workspace, or unknown settings, is refused and creates nothing", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const w = await workspace(cookie, "個人");
    const other = await workspace(cookie, "会社 A");

    for (const body of [
      { ...settings, workspaceId: other.id },
      { ...settings, id: "bot_x" },
      { ...settings, model: "gpt-5" },
      { ...settings, tools: ["shell"] },
      { ...settings, tools: ["memory", "memory"] },
      { ...settings, name: "" },
      { ...settings, instructions: " " },
    ]) {
      const res = await b.call(`/api/workspaces/${w.id}/bots`, { method: "POST", cookie, body });
      expect(res.status).toBe(400);
    }
    expect(await botNames(cookie, w.id)).toEqual([]);
    expect(await botNames(cookie, other.id)).toEqual([]);
  });

  test("an update cannot move a Bot to another Workspace or change its instructions", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const w = await workspace(cookie, "個人");
    const other = await workspace(cookie, "会社 A");
    const bot = await createBot(cookie, w.id);

    for (const body of [{ workspaceId: other.id }, { id: "bot_x" }, { instructions: "別の指示" }, {}]) {
      const res = await b.call(`/api/workspaces/${w.id}/bots/${bot.id}`, { method: "PATCH", cookie, body });
      expect(res.status).toBe(400);
    }
    const res = await b.call(`/api/workspaces/${w.id}/bots/${bot.id}`, { cookie });
    expect(BotItem.parse(await res.json())).toEqual(bot);
    expect(await botNames(cookie, other.id)).toEqual([]);
  });
});

describe("Bot ids across Workspaces", () => {
  test("another Workspace's Bot id is not found for reads and updates, and the Bot stays unchanged", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const personal = await workspace(cookie, "個人");
    const work = await workspace(cookie, "会社 A");
    const bot = await createBot(cookie, personal.id);

    const read = await b.call(`/api/workspaces/${work.id}/bots/${bot.id}`, { cookie });
    expect(read.status).toBe(404);
    expect(await errorKind(read)).toBe("not_found");
    const update = await b.call(`/api/workspaces/${work.id}/bots/${bot.id}`, {
      method: "PATCH",
      cookie,
      body: { name: "乗っ取り", model: "opus" },
    });
    expect(update.status).toBe(404);

    expect(await botNames(cookie, work.id)).toEqual([]);
    const res = await b.call(`/api/workspaces/${personal.id}/bots/${bot.id}`, { cookie });
    expect(BotItem.parse(await res.json())).toEqual(bot);
  });

  test("a Bot list cursor from another Workspace is refused", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const personal = await workspace(cookie, "個人");
    const work = await workspace(cookie, "会社 A");
    await createBot(cookie, personal.id);
    await createBot(cookie, personal.id);
    await createBot(cookie, work.id);

    const first = await b.call(`/api/workspaces/${personal.id}/bots?limit=1`, { cookie });
    const page = BotList.parse(await first.json());
    expect(page.nextCursor).toBeDefined();

    const next = await b.call(`/api/workspaces/${personal.id}/bots?limit=1&cursor=${page.nextCursor}`, {
      cookie,
    });
    expect(BotList.parse(await next.json()).bots).toHaveLength(1);
    const crossed = await b.call(`/api/workspaces/${work.id}/bots?cursor=${page.nextCursor}`, { cookie });
    expect(crossed.status).toBe(400);
    expect(await errorKind(crossed)).toBe("bad_request");
  });

  test("Bots are neither readable nor creatable without a Login or from another origin", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const w = await workspace(cookie, "個人");
    const bot = await createBot(cookie, w.id);

    expect((await b.call(`/api/workspaces/${w.id}/bots`)).status).toBe(401);
    expect((await b.call(`/api/workspaces/${w.id}/bots/${bot.id}`)).status).toBe(401);
    expect((await b.call(`/api/workspaces/${w.id}/bots`, { method: "POST", body: settings })).status).toBe(
      401,
    );
    const forged = await b.call(`/api/workspaces/${w.id}/bots`, {
      method: "POST",
      cookie,
      body: settings,
      headers: { origin: "http://evil.example", "sec-fetch-site": "cross-site" },
    });
    expect(forged.status).toBe(403);
    expect(await botNames(cookie, w.id)).toEqual(["仕事 Bot"]);
  });
});
