import { afterEach, describe, expect, test } from "bun:test";
import { AttachmentFiles } from "@momo/agent";
import { MemoryList, MessagePage } from "@momo/contracts";
import { openDatabase } from "@momo/migrator";
import { resolveTenant } from "@momo/workspace";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { deleteBotEverywhere, deleteWorkspaceEverywhere } from "./deletion.ts";
import {
  Api,
  buildGateFixture,
  finished,
  frames,
  type GateConversation,
  type GateFixture,
} from "./gate-fixture.ts";
import { startTestBackend } from "./testing.ts";

let api: Api;

afterEach(async () => {
  await api.b.cleanup();
});

async function start() {
  const b = await startTestBackend({ fakeRunnerDelayMs: 0 });
  api = new Api(b, await b.login());
  return buildGateFixture(api);
}

/** Nothing is running, so the log ends at streamAfter. */
async function eventIds(c: GateConversation): Promise<number[]> {
  const last = (await api.ok(`${c.base}/messages`, MessagePage)).streamAfter;
  const res = await api.call(`${c.base}/events?after=0`);
  return (await frames(res, (x) => x.id === last)).frames.map((x) => x.id);
}

async function state(f: GateFixture) {
  const out: unknown[] = [];
  for (const c of f.conversations) {
    out.push(await api.ok(`${c.base}/messages`, MessagePage));
    out.push(await (await api.call(`${c.base}/attachments/${c.attachmentId}`)).text());
  }
  for (const bot of f.bots)
    out.push(await api.ok(`/api/workspaces/${bot.workspaceId}/bots/${bot.id}/memory`, MemoryList));
  return out;
}

describe("restarting the backend on the 2×2×2 fixture", () => {
  test("Conversations, Memory items, Attachments and the Login come back, and each stream resumes after Last-Event-ID", async () => {
    const f = await start();
    const before = await state(f);
    const ids = new Map<GateConversation, number[]>();
    for (const c of f.conversations) ids.set(c, await eventIds(c));
    const open = await api.call(`${f.conversations[0]!.base}/events?after=0`);

    api.b = await api.b.restart({ fakeRunnerDelayMs: 0 });

    // The stop ends or resets the open stream; either way the browser reconnects with Last-Event-ID.
    expect(
      await frames(open).then(
        (r) => r.ended,
        () => true,
      ),
    ).toBe(true);
    expect(await state(f)).toEqual(before);
    for (const c of f.conversations) {
      const old = ids.get(c)!;
      const from = old[Math.floor(old.length / 2)]!;
      const resumed = await api.call(`${c.base}/events`, { headers: { "last-event-id": String(from) } });
      expect(resumed.status).toBe(200);
      const { run } = await api.say(`/api/workspaces/${c.workspaceId}`, c.base, `再起動のあと ${c.secret}`);
      const got = (await frames(resumed, finished(run.id))).frames;

      const missed = old.filter((id) => id > from);
      expect(missed.length).toBeGreaterThan(0);
      expect(got.map((x) => x.id).slice(0, missed.length)).toEqual(missed);
      const fresh = got.filter((x) => x.id > old.at(-1)!);
      expect(fresh[0]!.event).toMatchObject({ kind: "message_created", message: { conversationId: c.id } });
      expect(fresh.at(-1)!.event).toEqual({ kind: "run_finished", runId: run.id, status: "completed" });
      const text = JSON.stringify(got);
      for (const other of f.conversations) if (other !== c) expect(text).not.toContain(other.secret);
    }
  });

  test("a resume after a restart checks the Login and the Workspace again", async () => {
    const f = await start();
    const [mine, theirs] = [
      f.workspaces[0]!.bots[0]!.conversations[0]!,
      f.workspaces[1]!.bots[0]!.conversations[0]!,
    ];
    api.b = await api.b.restart({ fakeRunnerDelayMs: 0 });
    const resume = (path: string, cookie?: string) =>
      api.b.call(`${path}/events`, { cookie, headers: { "last-event-id": "0" } });

    expect((await resume(mine.base, api.cookie)).status).toBe(200);
    expect(
      (await resume(`/api/workspaces/${theirs.workspaceId}/conversations/${mine.id}`, api.cookie)).status,
    ).toBe(404);
    expect((await resume(mine.base)).status).toBe(401);
    const loginId = ((await (await api.call("/api/status")).json()) as { loginId: string }).loginId;
    expect((await api.call(`/api/logins/${loginId}`, { method: "DELETE" })).status).toBe(204);
    api.b = await api.b.restart({ fakeRunnerDelayMs: 0 });
    expect((await resume(mine.base, api.cookie)).status).toBe(401);
  });

  test("Attachment files that a delete left behind when the process stopped after its commit are removed at the next start", async () => {
    const f = await start();
    const [w0, w1] = f.workspaces as [GateFixture["workspaces"][0], GateFixture["workspaces"][0]];
    const [gone, kept] = w1.bots as [GateFixture["bots"][0], GateFixture["bots"][0]];
    await api.b.stop();

    class Stopped extends Error {}
    class StopsBeforeRemovingFiles extends AttachmentFiles {
      override remove(): void {
        throw new Stopped();
      }
      override removeWorkspace(): void {
        throw new Stopped();
      }
    }
    const root = join(api.b.dataDir, "attachments");
    const sqlite = openDatabase(join(api.b.dataDir, "app.db"));
    const db = drizzle({ client: sqlite });
    const files = new StopsBeforeRemovingFiles(root);
    const owner = { kind: "owner", loginId: "login_test" } as const;
    expect(() => deleteWorkspaceEverywhere(db, files, resolveTenant(db, w0.id, owner)!)).toThrow(Stopped);
    expect(() => deleteBotEverywhere(db, files, resolveTenant(db, w1.id, owner)!, gone.id)).toThrow(Stopped);
    sqlite.close();
    expect(readdirSync(join(root, w0.id))).toHaveLength(4);
    expect(readdirSync(join(root, w1.id))).toHaveLength(4);

    api.b = await api.b.restart({ fakeRunnerDelayMs: 0 });

    expect(existsSync(join(root, w0.id))).toBe(false);
    expect(readdirSync(join(root, w1.id)).toSorted()).toEqual(
      kept.conversations.map((c) => c.attachmentId).toSorted(),
    );
    for (const c of kept.conversations) {
      expect(await (await api.call(`${c.base}/attachments/${c.attachmentId}`)).text()).toBe(c.attachmentText);
    }
  });
});
