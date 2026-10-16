import { afterEach, describe, expect, test } from "bun:test";
import {
  ATTACHMENT_SIZE_MAX,
  BotItem,
  ConversationItem,
  MessagePage,
  PostMessageResponse,
  WorkspaceItem,
} from "@momo/contracts";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { startTestBackend, type TestBackend } from "./testing.ts";

let b: TestBackend;

afterEach(async () => {
  await b.cleanup();
});

async function workspace(cookie: string, name: string) {
  const res = await b.call("/api/workspaces", { method: "POST", cookie, body: { name } });
  return WorkspaceItem.parse(await res.json());
}

async function conversation(cookie: string, w: WorkspaceItem) {
  const bot = BotItem.parse(
    await (
      await b.call(`/api/workspaces/${w.id}/bots`, {
        method: "POST",
        cookie,
        body: { name: "Bot", instructions: "手伝う", model: "sonnet", tools: [] },
      })
    ).json(),
  );
  const c = ConversationItem.parse(
    await (
      await b.call(`/api/workspaces/${w.id}/conversations`, {
        method: "POST",
        cookie,
        body: { primaryBotId: bot.id },
      })
    ).json(),
  );
  return `/api/workspaces/${w.id}/conversations/${c.id}`;
}

function form(text: string, files: File[]): FormData {
  const data = new FormData();
  data.set("text", text);
  for (const file of files) data.append("file", file);
  return data;
}

const html = () =>
  new File(["<script>fetch('/api/workspaces')</script><p>計画</p>"], "plan.html", { type: "text/html" });

async function attach(cookie: string, base: string, files: File[], text = "見て") {
  const res = await b.call(`${base}/messages`, { method: "POST", cookie, form: form(text, files) });
  expect(res.status).toBe(201);
  return PostMessageResponse.parse(await res.json());
}

const attachmentsDir = () => join(b.dataDir, "attachments");

function storedFiles(): string[] {
  try {
    return readdirSync(attachmentsDir(), { recursive: true, encoding: "utf8" });
  } catch {
    return [];
  }
}

describe("Attachments over the API", () => {
  test("a message with files lists them, and each is served sandboxed from its Conversation", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const w = await workspace(cookie, "個人");
    const base = await conversation(cookie, w);

    const { message } = await attach(cookie, base, [
      html(),
      new File(["メモ"], "memo.txt", { type: "text/plain" }),
    ]);
    expect(message.attachments.map((a) => [a.name, a.contentType])).toEqual([
      ["plan.html", "text/html"],
      ["memo.txt", "text/plain"],
    ]);
    const history = MessagePage.parse(await (await b.call(`${base}/messages`, { cookie })).json());
    expect(history.messages[0]!.attachments).toEqual(message.attachments);

    const [plan, memo] = message.attachments;
    const res = await b.call(`${base}/attachments/${plan!.id}`, { cookie });
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp.split(";").map((d) => d.trim())).toContain("sandbox");
    expect(csp).not.toContain("allow-");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe("inline; filename*=UTF-8''plan.html");
    expect(await res.text()).toContain("<p>計画</p>");

    const text = await b.call(`${base}/attachments/${memo!.id}`, { cookie });
    expect(await text.text()).toBe("メモ");

    const file = join(attachmentsDir(), w.id, plan!.id);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(attachmentsDir(), w.id)).mode & 0o777).toBe(0o700);
  });

  test("an Attachment cannot be read with a swapped id, another Workspace's path or another Conversation", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const wa = await workspace(cookie, "個人");
    const wb = await workspace(cookie, "会社 A");
    const a1 = await conversation(cookie, wa);
    const a2 = await conversation(cookie, wa);
    const b1 = await conversation(cookie, wb);
    const [mine] = (await attach(cookie, a1, [html()])).message.attachments;
    const [theirs] = (await attach(cookie, b1, [new File(["秘密"], "secret.txt")])).message.attachments;

    const refused = [
      `${a1}/attachments/${theirs!.id}`,
      `${a2}/attachments/${mine!.id}`,
      `${a2}/attachments/${theirs!.id}`,
      `${b1}/attachments/${mine!.id}`,
      `${a1.replace(wa.id, wb.id)}/attachments/${mine!.id}`,
      `${b1.replace(wb.id, wa.id)}/attachments/${theirs!.id}`,
      `${a1}/attachments/attachment_00000000-0000-7000-8000-000000000000`,
      `${a1}/attachments/${encodeURIComponent(`../${wb.id}/${theirs!.id}`)}`,
      `${a1}/attachments/%2e%2e%2f${theirs!.id}`,
    ];
    for (const path of refused) {
      const res = await b.call(path, { cookie });
      expect([path, res.status]).toEqual([path, 404]);
      expect(await res.text()).not.toContain("秘密");
    }
  });

  test("the attachment route needs a Login and a same-origin request", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const base = await conversation(cookie, await workspace(cookie, "個人"));
    const [plan] = (await attach(cookie, base, [html()])).message.attachments;
    const path = `${base}/attachments/${plan!.id}`;

    expect((await b.call(path)).status).toBe(401);
    // A sandboxed frame has an opaque origin, so its own requests arrive cross-site.
    expect((await b.call(path, { cookie, headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    const fromFrame = await b.call(`/api/workspaces`, {
      method: "POST",
      cookie,
      body: { name: "乗っ取り" },
      headers: { origin: "null", "sec-fetch-site": "cross-site" },
    });
    expect(fromFrame.status).toBe(403);
  });

  test("refuses too many or too large files, or a file with neither text nor files, and stores nothing", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const base = await conversation(cookie, await workspace(cookie, "個人"));
    const bodies = [
      form(
        "多すぎ",
        Array.from({ length: 5 }, (_, i) => new File(["x"], `${i}.txt`)),
      ),
      form("大きすぎ", [new File([new Uint8Array(ATTACHMENT_SIZE_MAX + 1)], "big.bin")]),
      form("", []),
      form("x".repeat(4001), [new File(["x"], "a.txt")]),
    ];
    const notFile = new FormData();
    notFile.set("text", "文字だけ");
    notFile.set("file", "not a file");
    bodies.push(notFile);
    for (const data of bodies) {
      const res = await b.call(`${base}/messages`, { method: "POST", cookie, form: data });
      expect(res.status).toBe(400);
    }
    expect(storedFiles()).toEqual([]);
    const history = MessagePage.parse(await (await b.call(`${base}/messages`, { cookie })).json());
    expect(history.messages).toEqual([]);
  });

  test("files alone make a message, and Attachments survive a restart", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const base = await conversation(cookie, await workspace(cookie, "個人"));
    const [memo] = (await attach(cookie, base, [new File(["残る"], "memo.txt")], "")).message.attachments;

    b = await b.restart();
    const res = await b.call(`${base}/attachments/${memo!.id}`, { cookie });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("残る");
  });
});
