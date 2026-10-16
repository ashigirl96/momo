import { afterEach, describe, expect, test } from "bun:test";
import {
  ApiError,
  BotItem,
  ConversationDetail,
  ConversationItem,
  ConversationList,
  MessagePage,
  PostMessageResponse,
  ResetSessionResponse,
  RunItem,
  UpdateBotResponse,
  WorkspaceItem,
  type ConversationEvent,
} from "@momo/contracts";
import { startTestBackend, type TestBackend } from "./testing.ts";

let b: TestBackend;

afterEach(async () => {
  await b.cleanup();
});

type Frame = { id: number; event: ConversationEvent };

async function setup(cookie: string, name: string) {
  const w = WorkspaceItem.parse(
    await (await b.call("/api/workspaces", { method: "POST", cookie, body: { name } })).json(),
  );
  const bot = BotItem.parse(
    await (
      await b.call(`/api/workspaces/${w.id}/bots`, {
        method: "POST",
        cookie,
        body: { name: `${name} の Bot`, instructions: "手伝う", model: "sonnet", tools: [] },
      })
    ).json(),
  );
  const res = await b.call(`/api/workspaces/${w.id}/conversations`, {
    method: "POST",
    cookie,
    body: { primaryBotId: bot.id },
  });
  expect(res.status).toBe(201);
  const conversation = ConversationItem.parse(await res.json());
  return { w, bot, conversation, base: `/api/workspaces/${w.id}/conversations/${conversation.id}` };
}

async function history(cookie: string, base: string): Promise<MessagePage> {
  const res = await b.call(`${base}/messages`, { cookie });
  expect(res.status).toBe(200);
  return MessagePage.parse(await res.json());
}

async function say(cookie: string, base: string, text: string): Promise<PostMessageResponse> {
  const res = await b.call(`${base}/messages`, { method: "POST", cookie, body: { text } });
  expect(res.status).toBe(201);
  return PostMessageResponse.parse(await res.json());
}

/** Reads SSE frames until `until` matches one, or the server ends the stream. */
async function frames(
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

const finished = (runId: string) => (f: Frame) => f.event.kind === "run_finished" && f.event.runId === runId;

async function errorKind(res: Response): Promise<string> {
  return ApiError.parse(await res.json()).error.kind;
}

describe("talking in a Conversation", () => {
  test("a message gets the typing indicator, then the fake runner's reply streamed over SSE, and a reload shows the same history", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const { base, bot } = await setup(cookie, "個人");
    const before = await history(cookie, base);
    expect(before.messages).toEqual([]);

    const stream = await b.call(`${base}/events?after=${before.streamAfter}`, { cookie });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toBe("text/event-stream");
    const { message, run } = await say(cookie, base, "旅行の計画を立てたい");
    expect(run).toMatchObject({ botId: bot.id, status: "queued" });

    const got = (await frames(stream, finished(run.id))).frames.map((f) => f.event);
    const kinds = got.map((e) => e.kind);
    expect(kinds.slice(0, 3)).toEqual(["message_created", "run_queued", "run_started"]);
    expect(kinds.slice(-2)).toEqual(["message_created", "run_finished"]);
    expect(kinds.filter((k) => k === "run_delta").length).toBeGreaterThan(1);
    const streamed = got.map((e) => (e.kind === "run_delta" ? e.text : "")).join("");
    expect(streamed).toBe("**1 件目**の発言を受け取りました: 旅行の計画を立てたい");
    expect(got.at(-1)).toEqual({ kind: "run_finished", runId: run.id, status: "completed" });

    const after = await history(cookie, base);
    expect(after.messages.map((m) => [m.author.kind, m.text])).toEqual([
      ["owner", "旅行の計画を立てたい"],
      ["bot", streamed],
    ]);
    expect(after.messages[0]!.id).toBe(message.id);

    b = await b.restart();
    expect((await history(cookie, base)).messages).toEqual(after.messages);
  });

  test("a reload during a Run replays its stream from the start of the Run", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 40 });
    const cookie = await b.login();
    const { base } = await setup(cookie, "個人");
    const { run } = await say(cookie, base, "長めの返事をください");
    await Bun.sleep(100);

    const page = await history(cookie, base);
    const stream = await b.call(`${base}/events?after=${page.streamAfter}`, { cookie });
    const kinds = (await frames(stream, finished(run.id))).frames.map((f) => f.event.kind);
    expect(kinds[0]).toBe("run_queued");
    expect(kinds).toContain("run_started");
    expect(kinds.at(-1)).toBe("run_finished");
  });

  test("Runs of one Session run one at a time", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 5 });
    const cookie = await b.login();
    const { base } = await setup(cookie, "個人");
    const stream = await b.call(`${base}/events?after=0`, { cookie });
    const first = (await say(cookie, base, "1")).run;
    const second = (await say(cookie, base, "2")).run;
    expect(second.sessionId).toBe(first.sessionId);

    const got = (await frames(stream, finished(second.id))).frames.map((f) => f.event);
    const at = (kind: string, runId: string) =>
      got.findIndex((e) => e.kind === kind && "runId" in e && e.runId === runId);
    expect(at("run_started", second.id)).toBeGreaterThan(at("run_finished", first.id));
    expect((await history(cookie, base)).messages.map((m) => m.text)).toEqual([
      "1",
      "2",
      "**1 件目**の発言を受け取りました: 1",
      "**2 件目**の発言を受け取りました: 2",
    ]);
  });

  test("a Run cut off by a restart fails and its Conversation keeps working", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 200 });
    const cookie = await b.login();
    const { base, w } = await setup(cookie, "個人");
    const { run } = await say(cookie, base, "途中で止まる");
    await Bun.sleep(50);

    b = await b.restart({ fakeRunnerDelayMs: 1 });
    const res = await b.call(`/api/workspaces/${w.id}/runs/${run.id}`, { cookie });
    expect(RunItem.parse(await res.json()).status).toBe("failed");

    const stream = await b.call(`${base}/events?after=0`, { cookie });
    const next = (await say(cookie, base, "もう一度")).run;
    const got = (await frames(stream, finished(next.id))).frames.map((f) => f.event);
    expect(got).toContainEqual({ kind: "run_finished", runId: run.id, status: "failed" });
    expect(got.at(-1)).toEqual({ kind: "run_finished", runId: next.id, status: "completed" });
  });

  test("an empty or overlong message, or one naming a Workspace, is refused", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const { base, w } = await setup(cookie, "個人");

    for (const body of [{ text: " " }, { text: "x".repeat(4001) }, { text: "x", workspaceId: w.id }]) {
      const res = await b.call(`${base}/messages`, { method: "POST", cookie, body });
      expect(res.status).toBe(400);
    }
    expect((await history(cookie, base)).messages).toEqual([]);
  });

  test("Conversations are listed newest first with their primary Bot and participants", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const { w, bot, conversation } = await setup(cookie, "個人");
    const res = await b.call(`/api/workspaces/${w.id}/conversations`, {
      method: "POST",
      cookie,
      body: { primaryBotId: bot.id },
    });
    const second = ConversationItem.parse(await res.json());

    const list = ConversationList.parse(
      await (await b.call(`/api/workspaces/${w.id}/conversations`, { cookie })).json(),
    );
    expect(list.conversations.map((c) => c.id)).toEqual([second.id, conversation.id]);
    const detail = ConversationDetail.parse(
      await (await b.call(`/api/workspaces/${w.id}/conversations/${conversation.id}`, { cookie })).json(),
    );
    expect(detail.participants).toEqual([{ botId: bot.id, role: "primary" }]);
  });
});

describe("SSE resume and authorization", () => {
  test("a resume continues after Last-Event-ID, also after a restart, and checks the Login every time", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const { base } = await setup(cookie, "個人");
    const { run } = await say(cookie, base, "こんにちは");
    const all = (await frames(await b.call(`${base}/events?after=0`, { cookie }), finished(run.id))).frames;

    const resume = await b.call(`${base}/events?after=0`, {
      cookie,
      headers: { "last-event-id": String(all[2]!.id) },
    });
    const resumed = (await frames(resume, finished(run.id))).frames;
    expect(resumed.map((f) => f.id)).toEqual(all.slice(3).map((f) => f.id));

    b = await b.restart();
    const afterRestart = await b.call(`${base}/events`, {
      cookie,
      headers: { "last-event-id": String(all[4]!.id) },
    });
    expect((await frames(afterRestart, finished(run.id))).frames.map((f) => f.id)).toEqual(
      all.slice(5).map((f) => f.id),
    );

    const noLogin = await b.call(`${base}/events`, { headers: { "last-event-id": "0" } });
    expect(noLogin.status).toBe(401);
    const loginId = ((await (await b.call("/api/status", { cookie })).json()) as { loginId: string }).loginId;
    await b.call(`/api/logins/${loginId}`, { method: "DELETE", cookie });
    const revoked = await b.call(`${base}/events`, { cookie, headers: { "last-event-id": "0" } });
    expect(revoked.status).toBe(401);
  });

  test("an open stream ends once its Login is revoked", async () => {
    b = await startTestBackend({ streamCheckMs: 30 });
    const cookie = await b.login();
    const other = await b.login("other");
    const { base } = await setup(cookie, "個人");
    const stream = await b.call(`${base}/events`, { cookie });
    const loginId = ((await (await b.call("/api/status", { cookie })).json()) as { loginId: string }).loginId;
    await b.call(`/api/logins/${loginId}`, { method: "DELETE", cookie: other });

    expect((await frames(stream, undefined, 1000)).ended).toBe(true);
  });

  test("a Last-Event-ID that is not a whole number is refused", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const { base } = await setup(cookie, "個人");

    for (const id of ["-1", "abc", "1.5"]) {
      const res = await b.call(`${base}/events`, { cookie, headers: { "last-event-id": id } });
      expect(res.status).toBe(400);
    }
    expect((await b.call(`${base}/events?after=x`, { cookie })).status).toBe(400);
  });

  test("a subscription never returns another Workspace's or Conversation's events, whatever Last-Event-ID says", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const a = await setup(cookie, "A");
    const other = await setup(cookie, "B");
    const { run } = await say(cookie, a.base, "A の秘密");
    const aIds = (
      await frames(await b.call(`${a.base}/events?after=0`, { cookie }), finished(run.id))
    ).frames.map((f) => f.id);

    const crossed = await b.call(`/api/workspaces/${other.w.id}/conversations/${a.conversation.id}/events`, {
      cookie,
      headers: { "last-event-id": "0" },
    });
    expect(crossed.status).toBe(404);

    const otherRun = (await say(cookie, other.base, "B の発言")).run;
    const own = (
      await frames(
        await b.call(`${other.base}/events`, { cookie, headers: { "last-event-id": "0" } }),
        finished(otherRun.id),
      )
    ).frames;
    expect(own.some((f) => aIds.includes(f.id))).toBe(false);
    expect(JSON.stringify(own)).not.toContain("A の秘密");
  });

  test("a cross-site page cannot open the stream", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const { base } = await setup(cookie, "個人");

    const res = await b.call(`${base}/events`, { cookie, headers: { "sec-fetch-site": "cross-site" } });
    expect(res.status).toBe(403);
  });
});

describe("ids of another Workspace", () => {
  test("Conversation and Run ids of another Workspace are refused, and nothing is written", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const a = await setup(cookie, "A");
    const other = await setup(cookie, "B");
    const { run } = await say(cookie, a.base, "A の発言");
    const crossed = `/api/workspaces/${other.w.id}/conversations/${a.conversation.id}`;

    for (const res of [
      await b.call(crossed, { cookie }),
      await b.call(`${crossed}/messages`, { cookie }),
      await b.call(`${crossed}/messages`, { method: "POST", cookie, body: { text: "乗っ取り" } }),
      await b.call(`/api/workspaces/${other.w.id}/runs/${run.id}`, { cookie }),
      await b.call(`/api/workspaces/${other.w.id}/conversations`, {
        method: "POST",
        cookie,
        body: { primaryBotId: a.bot.id },
      }),
    ]) {
      expect(res.status).toBe(404);
      expect(await errorKind(res)).toBe("not_found");
    }
    const naming = await b.call(`/api/workspaces/${other.w.id}/conversations`, {
      method: "POST",
      cookie,
      body: { primaryBotId: other.bot.id, workspaceId: a.w.id },
    });
    expect(naming.status).toBe(400);

    expect((await history(cookie, a.base)).messages.map((m) => m.text)).not.toContain("乗っ取り");
    const list = ConversationList.parse(
      await (await b.call(`/api/workspaces/${other.w.id}/conversations`, { cookie })).json(),
    );
    expect(list.conversations.map((c) => c.id)).toEqual([other.conversation.id]);
  });

  test("a history cursor of another Workspace is refused", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const a = await setup(cookie, "A");
    const other = await setup(cookie, "B");
    for (const text of ["1", "2"]) await say(cookie, a.base, text);
    const page = MessagePage.parse(await (await b.call(`${a.base}/messages?limit=1`, { cookie })).json());
    expect(page.nextCursor).toBeDefined();

    const res = await b.call(`${other.base}/messages?cursor=${page.nextCursor}`, { cookie });
    expect(res.status).toBe(400);
  });
});

async function cancel(cookie: string, w: { id: string }, runId: string) {
  return b.call(`/api/workspaces/${w.id}/runs/${runId}/cancel`, { method: "POST", cookie });
}

async function reset(cookie: string, base: string) {
  return b.call(`${base}/reset`, { method: "POST", cookie });
}

const LONG = "とても長い返事をください。".repeat(5);

/** The Conversation's events from the start until `until` matches, on a fresh stream. */
async function eventsUntil(cookie: string, base: string, until: (frame: Frame) => boolean) {
  const stream = await b.call(`${base}/events?after=0`, { cookie });
  return (await frames(stream, until)).frames.map((f) => f.event);
}

describe("cancelling a Run", () => {
  test("a Run cancelled mid-reply stops, keeps what it wrote marked cancelled, and shows the same after a reload and a restart", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 30 });
    const cookie = await b.login();
    const { base, w } = await setup(cookie, "個人");
    const stream = await b.call(`${base}/events?after=0`, { cookie });
    const { run } = await say(cookie, base, LONG);
    await frames(stream, (f) => f.event.kind === "run_delta");

    const res = await cancel(cookie, w, run.id);
    expect(res.status).toBe(200);
    expect(RunItem.parse(await res.json()).status).toBe("cancelled");
    await Bun.sleep(150);

    const page = await history(cookie, base);
    const reply = page.messages[1]!;
    expect(reply.author).toMatchObject({ kind: "bot", runId: run.id, cancelled: true });
    expect(reply.text.length).toBeGreaterThan(0);
    expect(reply.text.length).toBeLessThan(`**1 件目**の発言を受け取りました: ${LONG}`.length);
    const replay = await b.call(`${base}/events?after=0`, { cookie });
    const events = (await frames(replay, finished(run.id))).frames.map((f) => f.event);
    expect(events.at(-1)).toEqual({ kind: "run_finished", runId: run.id, status: "cancelled" });

    b = await b.restart();
    expect((await history(cookie, base)).messages).toEqual(page.messages);
    const after = await b.call(`/api/workspaces/${w.id}/runs/${run.id}`, { cookie });
    expect(RunItem.parse(await after.json()).status).toBe("cancelled");
  });

  test("after a cancel the Session takes the next message, and a queued Run can be cancelled before it starts", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 20 });
    const cookie = await b.login();
    const { base, w } = await setup(cookie, "個人");
    const stream = await b.call(`${base}/events?after=0`, { cookie });
    const first = (await say(cookie, base, LONG)).run;
    const second = (await say(cookie, base, "2")).run;
    expect(RunItem.parse(await (await cancel(cookie, w, second.id)).json()).status).toBe("cancelled");
    await cancel(cookie, w, first.id);
    const third = (await say(cookie, base, "3")).run;

    const got = (await frames(stream, finished(third.id))).frames.map((f) => f.event);
    expect(got).not.toContainEqual({ kind: "run_started", runId: second.id });
    expect(got.at(-1)).toEqual({ kind: "run_finished", runId: third.id, status: "completed" });
    const done = await cancel(cookie, w, third.id);
    expect(RunItem.parse(await done.json()).status).toBe("completed");
  });
});

describe("renewing a Session", () => {
  test("a reset closes the Session and the Conversation goes on in a new one; the closed Session's messages stay", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 1 });
    const cookie = await b.login();
    const { base } = await setup(cookie, "個人");
    const stream = await b.call(`${base}/events?after=0`, { cookie });
    const first = (await say(cookie, base, "1")).run;
    await frames(stream, finished(first.id));

    const res = await reset(cookie, base);
    expect(res.status).toBe(200);
    expect(ResetSessionResponse.parse(await res.json()).closed).toMatchObject({
      id: first.sessionId,
      status: "closed",
      closedBy: "reset",
    });
    const next = (await say(cookie, base, "2")).run;
    expect(next.sessionId).not.toBe(first.sessionId);
    await eventsUntil(cookie, base, finished(next.id));

    const page = await history(cookie, base);
    expect(page.messages.map((m) => [m.sessionId, m.text])).toEqual([
      [first.sessionId, "1"],
      [first.sessionId, "**1 件目**の発言を受け取りました: 1"],
      [next.sessionId, "2"],
      [next.sessionId, "**1 件目**の発言を受け取りました: 2"],
    ]);
    expect(page.sessions.map((s) => [s.id, s.status, s.closedBy])).toEqual([
      [first.sessionId, "closed", "reset"],
      [next.sessionId, "open", undefined],
    ]);
  });

  test("a reset during a reply cancels the running Run", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 30 });
    const cookie = await b.login();
    const { base, w } = await setup(cookie, "個人");
    const stream = await b.call(`${base}/events?after=0`, { cookie });
    const { run } = await say(cookie, base, LONG);
    await frames(stream, (f) => f.event.kind === "run_delta");

    await reset(cookie, base);
    const got = await eventsUntil(cookie, base, (f) => f.event.kind === "session_closed");
    expect(got).toContainEqual({ kind: "run_finished", runId: run.id, status: "cancelled" });
    const res = await b.call(`/api/workspaces/${w.id}/runs/${run.id}`, { cookie });
    expect(RunItem.parse(await res.json()).status).toBe("cancelled");
  });

  test("saving new instructions renews the Bot's Session and says so", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 1 });
    const cookie = await b.login();
    const { base, w, bot } = await setup(cookie, "個人");
    const stream = await b.call(`${base}/events?after=0`, { cookie });
    const first = (await say(cookie, base, "1")).run;
    await frames(stream, finished(first.id));

    const res = await b.call(`/api/workspaces/${w.id}/bots/${bot.id}`, {
      method: "PATCH",
      cookie,
      body: { instructions: "丁寧に手伝う" },
    });
    expect(res.status).toBe(200);
    expect(UpdateBotResponse.parse(await res.json())).toEqual({
      bot: { ...bot, instructions: "丁寧に手伝う", instructionsVersion: 2 },
      sessionsRenewed: true,
      closedSessions: 1,
    });
    const next = (await say(cookie, base, "2")).run;
    await eventsUntil(cookie, base, finished(next.id));

    const page = await history(cookie, base);
    expect(page.messages.at(-1)?.text).toBe("**1 件目**の発言を受け取りました: 2");
    expect(page.sessions.map((s) => [s.closedBy, s.botInstructionsVersion])).toEqual([
      ["instructions_changed", 1],
      [undefined, 2],
    ]);
  });

  test("a cross-site page or a request without a Login cannot cancel or reset", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 30 });
    const cookie = await b.login();
    const { base, w } = await setup(cookie, "個人");
    const { run } = await say(cookie, base, "1");
    const evil = { origin: "http://evil.example", "sec-fetch-site": "cross-site" };

    expect((await b.call(`${base}/reset`, { method: "POST", cookie, headers: evil })).status).toBe(403);
    expect((await b.call(`/api/workspaces/${w.id}/runs/${run.id}/cancel`, { method: "POST" })).status).toBe(
      401,
    );
    const page = await history(cookie, base);
    expect(page.sessions.map((s) => s.status)).toEqual(["open"]);
    expect(page.messages.some((m) => m.author.kind === "bot" && m.author.cancelled)).toBe(false);
  });

  test("Run, Conversation and Bot ids of another Workspace cannot cancel, reset or renew anything", async () => {
    b = await startTestBackend({ fakeRunnerDelayMs: 30 });
    const cookie = await b.login();
    const a = await setup(cookie, "A");
    const other = await setup(cookie, "B");
    const stream = await b.call(`${a.base}/events?after=0`, { cookie });
    const { run } = await say(cookie, a.base, "A の発言");
    const crossed = `/api/workspaces/${other.w.id}/conversations/${a.conversation.id}`;

    for (const res of [
      await cancel(cookie, other.w, run.id),
      await reset(cookie, crossed),
      await b.call(`/api/workspaces/${other.w.id}/bots/${a.bot.id}`, {
        method: "PATCH",
        cookie,
        body: { instructions: "乗っ取り" },
      }),
    ]) {
      expect(res.status).toBe(404);
      expect(await errorKind(res)).toBe("not_found");
    }

    const got = (await frames(stream, finished(run.id))).frames.map((f) => f.event);
    expect(got.at(-1)).toEqual({ kind: "run_finished", runId: run.id, status: "completed" });
    expect((await history(cookie, a.base)).sessions.map((s) => s.status)).toEqual(["open"]);
    const bot = await b.call(`/api/workspaces/${a.w.id}/bots/${a.bot.id}`, { cookie });
    expect(BotItem.parse(await bot.json())).toEqual(a.bot);
  });
});
