import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  BotItem,
  BotList,
  ConversationDetail,
  ConversationList,
  MemoryItem,
  MemoryList,
  MessagePage,
  RunItem,
} from "@momo/contracts";
import {
  Api,
  buildGateFixture,
  finished,
  frames,
  SHARED_SHORT_TERM,
  SHARED_TERM,
  type GateFixture,
} from "./gate-fixture.ts";
import { startTestBackend } from "./testing.ts";

let api: Api;
let f: GateFixture;

beforeAll(async () => {
  const b = await startTestBackend({ fakeRunnerDelayMs: 0 });
  api = new Api(b, await b.login());
  f = await buildGateFixture(api);
});

afterAll(async () => {
  await api.b.cleanup();
});

/** Status of each request, keyed by its path, so a failure names the combination. */
async function statuses(requests: { path: string; init?: Parameters<Api["call"]>[1] }[]) {
  const out: Record<string, number> = {};
  for (const { path, init } of requests) {
    const res = await api.call(path, init);
    const body = init?.body === undefined ? "" : ` ${JSON.stringify(init.body)}`;
    out[`${init?.method ?? "GET"} ${path}${body}`] = res.status;
    await res.body?.cancel();
  }
  return out;
}

const expected = (pairs: [string, boolean][], ok: number, refused = 404) =>
  Object.fromEntries(pairs.map(([key, allowed]) => [key, allowed ? ok : refused]));

/** Every message, Session, Memory item and Bot of the fixture, as the owner sees them. */
async function snapshot() {
  const out: unknown[] = [];
  for (const c of f.conversations) out.push(await api.ok(`${c.base}/messages`, MessagePage));
  for (const w of f.workspaces) {
    for (const bot of w.bots) {
      out.push(await api.ok(`${w.path}/bots/${bot.id}`, BotItem));
      out.push(await api.ok(`${w.path}/bots/${bot.id}/memory`, MemoryList));
    }
  }
  return out;
}

describe("2 Workspaces × 2 Bots × 2 Conversations: no id crosses", () => {
  test("the fixture has what the gate needs", () => {
    expect(f.workspaces).toHaveLength(2);
    expect(f.bots).toHaveLength(4);
    expect(f.conversations).toHaveLength(8);
    for (const bot of f.bots) expect(bot.memoryItemIds).toHaveLength(2);
    expect(new Set(f.conversations.flatMap((c) => c.sessionIds)).size).toBe(12);
  });

  test("a Bot answers only under its own Workspace's path, and a crossed write changes nothing", async () => {
    const before = await snapshot();
    const reads: [string, boolean][] = [];
    const writes: { path: string; init: Parameters<Api["call"]>[1] }[] = [];
    for (const w of f.workspaces) {
      for (const bot of f.bots) {
        const own = bot.workspaceId === w.id;
        for (const sub of ["", "/memory", "/deletion-preview"])
          reads.push([`GET ${w.path}/bots/${bot.id}${sub}`, own]);
        if (own) continue;
        writes.push({
          path: `${w.path}/bots/${bot.id}`,
          init: { method: "PATCH", body: { name: "乗っ取り" } },
        });
        writes.push({ path: `${w.path}/bots/${bot.id}`, init: { method: "DELETE" } });
        writes.push({
          path: `${w.path}/conversations`,
          init: { method: "POST", body: { primaryBotId: bot.id } },
        });
      }
    }
    expect(await statuses(reads.map(([key]) => ({ path: key.slice(4) })))).toEqual(expected(reads, 200));
    const crossed = await statuses(writes);
    expect(Object.values(crossed).every((s) => s === 404)).toBe(true);
    expect(Object.keys(crossed)).toHaveLength(2 * 2 * 3);

    expect(await snapshot()).toEqual(before);
    for (const w of f.workspaces) {
      const bots = await api.ok(`${w.path}/bots`, BotList);
      expect(bots.bots.map((b) => b.id).toSorted()).toEqual(w.bots.map((b) => b.id).toSorted());
      const conversations = await api.ok(`${w.path}/conversations`, ConversationList);
      expect(conversations.conversations.map((c) => c.id).toSorted()).toEqual(
        w.bots.flatMap((b) => b.conversations.map((c) => c.id)).toSorted(),
      );
    }
  });

  test("a Conversation answers only under its own Workspace's path, and a crossed post or reset writes nothing", async () => {
    const before = await snapshot();
    const reads: [string, boolean][] = [];
    const writes: { path: string; init: Parameters<Api["call"]>[1] }[] = [];
    for (const w of f.workspaces) {
      for (const c of f.conversations) {
        const own = c.workspaceId === w.id;
        const base = `${w.path}/conversations/${c.id}`;
        for (const sub of ["", "/messages", "/events?after=0"]) reads.push([`GET ${base}${sub}`, own]);
        if (own) continue;
        writes.push({ path: `${base}/messages`, init: { method: "POST", body: { text: "乗っ取り" } } });
        writes.push({ path: `${base}/reset`, init: { method: "POST" } });
      }
    }
    expect(await statuses(reads.map(([key]) => ({ path: key.slice(4) })))).toEqual(expected(reads, 200));
    const crossed = await statuses(writes);
    expect(Object.values(crossed).every((s) => s === 404)).toBe(true);
    expect(Object.keys(crossed)).toHaveLength(2 * 4 * 2);

    expect(await snapshot()).toEqual(before);
    for (const c of f.conversations) {
      const detail = await api.ok(
        `/api/workspaces/${c.workspaceId}/conversations/${c.id}`,
        ConversationDetail,
      );
      expect(detail.primaryBotId).toBe(c.botId);
    }
  });

  test("a Run answers only under its own Workspace's path, and a crossed cancel changes nothing", async () => {
    const runs = f.conversations.flatMap((c) => c.runIds.map((id) => ({ id, workspaceId: c.workspaceId })));
    const before = await Promise.all(
      runs.map((r) => api.ok(`/api/workspaces/${r.workspaceId}/runs/${r.id}`, RunItem)),
    );
    const reads: [string, boolean][] = [];
    const writes: { path: string; init: Parameters<Api["call"]>[1] }[] = [];
    for (const w of f.workspaces) {
      for (const run of runs) {
        reads.push([`GET ${w.path}/runs/${run.id}`, run.workspaceId === w.id]);
        if (run.workspaceId !== w.id)
          writes.push({ path: `${w.path}/runs/${run.id}/cancel`, init: { method: "POST" } });
      }
    }
    expect(await statuses(reads.map(([key]) => ({ path: key.slice(4) })))).toEqual(expected(reads, 200));
    expect(Object.values(await statuses(writes)).every((s) => s === 404)).toBe(true);
    expect(
      await Promise.all(runs.map((r) => api.ok(`/api/workspaces/${r.workspaceId}/runs/${r.id}`, RunItem))),
    ).toEqual(before);
    for (const c of f.conversations) {
      for (const runId of c.runIds) {
        const run = before.find((r) => r.id === runId)!;
        expect([run.conversationId, run.botId]).toEqual([c.id, c.botId]);
      }
    }
  });

  test("a Conversation's history shows only its own Sessions, and its messages belong to them", async () => {
    const seen = new Set<string>();
    for (const c of f.conversations) {
      const page = await api.ok(`${c.base}/messages`, MessagePage);
      expect(page.sessions.map((s) => s.id)).toEqual(c.sessionIds);
      for (const s of page.sessions) expect([s.conversationId, s.botId]).toEqual([c.id, c.botId]);
      for (const m of page.messages) {
        expect(m.conversationId).toBe(c.id);
        expect(c.sessionIds).toContain(m.sessionId!);
        if (m.author.kind === "bot") expect(c.runIds).toContain(m.author.runId);
      }
      for (const id of c.sessionIds) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      const text = JSON.stringify(page);
      for (const other of f.conversations) {
        if (other !== c) expect(text).not.toContain(other.secret);
      }
    }
  });

  test("a Memory item is found only under its own Workspace and Bot, and a crossed delete removes nothing", async () => {
    const items = f.bots.flatMap((bot) => bot.memoryItemIds.map((id) => ({ id, bot })));
    const reads: [string, boolean][] = [];
    const deletes: { path: string; init: Parameters<Api["call"]>[1] }[] = [];
    for (const w of f.workspaces) {
      for (const bot of f.bots) {
        for (const item of items) {
          const own = w.id === bot.workspaceId && item.bot === bot;
          const path = `${w.path}/bots/${bot.id}/memory/${item.id}`;
          reads.push([`GET ${path}`, own]);
          if (!own) deletes.push({ path, init: { method: "DELETE" } });
        }
      }
    }
    expect(reads).toHaveLength(2 * 4 * 8);
    expect(await statuses(reads.map(([key]) => ({ path: key.slice(4) })))).toEqual(expected(reads, 200));
    expect(Object.values(await statuses(deletes)).every((s) => s === 404)).toBe(true);

    for (const bot of f.bots) {
      const list = await api.ok(`/api/workspaces/${bot.workspaceId}/bots/${bot.id}/memory`, MemoryList);
      expect(list.items.map((i) => i.id).toSorted()).toEqual(bot.memoryItemIds.toSorted());
      expect(list.items.map((i) => i.body).toSorted()).toEqual(
        bot.conversations.map((c) => `${SHARED_TERM} ${SHARED_SHORT_TERM} ${c.secret}`).toSorted(),
      );
      for (const id of bot.memoryItemIds) {
        const item = await api.ok(
          `/api/workspaces/${bot.workspaceId}/bots/${bot.id}/memory/${id}`,
          MemoryItem,
        );
        expect(item.botId).toBe(bot.id);
      }
    }
  });

  test("an Attachment is served only from its own Conversation under its own Workspace", async () => {
    const reads: [string, boolean][] = [];
    for (const w of f.workspaces) {
      for (const c of f.conversations) {
        for (const owner of f.conversations) {
          const own = w.id === c.workspaceId && owner === c;
          reads.push([`GET ${w.path}/conversations/${c.id}/attachments/${owner.attachmentId}`, own]);
        }
      }
    }
    expect(reads).toHaveLength(2 * 8 * 8);
    expect(await statuses(reads.map(([key]) => ({ path: key.slice(4) })))).toEqual(expected(reads, 200));
    for (const c of f.conversations) {
      const res = await api.call(`${c.base}/attachments/${c.attachmentId}`);
      expect(await res.text()).toBe(c.attachmentText);
      expect(res.headers.get("content-security-policy")).toStartWith("sandbox;");
    }
  });

  test("a list cursor works only for the list and Workspace it came from", async () => {
    const lists = [
      ...f.workspaces.flatMap((w) => [`${w.path}/bots`, `${w.path}/conversations`]),
      ...f.bots.map((bot) => `/api/workspaces/${bot.workspaceId}/bots/${bot.id}/memory`),
      ...f.conversations.map((c) => `${c.base}/messages`),
    ];
    const cursors = new Map<string, string>();
    for (const list of lists) {
      const page = (await (await api.call(`${list}?limit=1`)).json()) as { nextCursor?: string };
      expect([list, typeof page.nextCursor]).toEqual([list, "string"]);
      cursors.set(list, page.nextCursor!);
    }
    const uses: [string, boolean][] = [];
    for (const [from, cursor] of cursors) {
      for (const at of lists)
        uses.push([`GET ${at}?limit=1&cursor=${encodeURIComponent(cursor)}`, from === at]);
    }
    expect(uses).toHaveLength(16 * 16);
    expect(await statuses(uses.map(([key]) => ({ path: key.slice(4) })))).toEqual(expected(uses, 200, 400));
  });

  test("each Conversation's stream carries only its own events, live and from any Last-Event-ID", async () => {
    const streams = await Promise.all(f.conversations.map((c) => api.call(`${c.base}/events`)));
    const posted: Awaited<ReturnType<Api["say"]>>[] = [];
    for (const c of f.conversations) {
      posted.push(await api.say(`/api/workspaces/${c.workspaceId}`, c.base, `live ${c.secret}`));
    }
    const live = await Promise.all(streams.map((s, i) => frames(s, finished(posted[i]!.run.id))));

    const all = await Promise.all(
      f.conversations.map(
        async (c, i) =>
          (await frames(await api.call(`${c.base}/events?after=0`), finished(posted[i]!.run.id))).frames,
      ),
    );
    f.conversations.forEach((c, i) => {
      const runIds = [...c.runIds, posted[i]!.run.id];
      expect(live[i]!.frames.map((x) => x.event.kind)).toContain("run_finished");
      for (const frame of [...live[i]!.frames, ...all[i]!]) {
        const e = frame.event;
        if (e.kind === "message_created") expect(e.message.conversationId).toBe(c.id);
        if (e.kind === "run_queued") expect([e.run.conversationId, e.run.botId]).toEqual([c.id, c.botId]);
        if (e.kind === "run_started" || e.kind === "run_delta" || e.kind === "run_finished")
          expect(runIds).toContain(e.runId);
        if (e.kind === "session_closed") expect(c.sessionIds).toContain(e.session.id);
      }
      const text = JSON.stringify([live[i], all[i]]);
      for (const other of f.conversations) if (other !== c) expect(text).not.toContain(other.secret);
    });

    for (const [i, c] of f.conversations.entries()) {
      for (const j of f.conversations.keys()) {
        if (i === j) continue;
        // Early in the other Conversation's log, so this Conversation's live Run comes after it.
        const from = all[j]![1]!.id;
        const resumed = await frames(
          await api.call(`${c.base}/events`, { headers: { "last-event-id": String(from) } }),
          finished(posted[i]!.run.id),
        );
        expect(resumed.frames.map((x) => x.id)).toEqual(all[i]!.filter((x) => x.id > from).map((x) => x.id));
      }
    }
  });

  test("a search finds only its own Bot's Memory items, by trigram and by the short-term fallback", async () => {
    for (const bot of f.bots) {
      const c = bot.conversations[0]!;
      const path = `/api/workspaces/${bot.workspaceId}`;
      for (const term of [SHARED_TERM, SHARED_SHORT_TERM]) {
        const { reply } = await api.say(path, c.base, `recall: ${term}`);
        const found = reply.split("\n").slice(1).toSorted();
        expect(found).toEqual(
          bot.conversations.map((x) => `- ${SHARED_TERM} ${SHARED_SHORT_TERM} ${x.secret}`).toSorted(),
        );
      }
      for (const other of f.conversations) {
        if (other.botId === bot.id) continue;
        expect((await api.say(path, c.base, `recall: ${other.secret}`)).reply).toBe(
          "記憶は見つかりませんでした",
        );
      }
    }
  });
});
