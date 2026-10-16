import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migratedTestDatabase, type TestDatabase } from "@momo/migrator/testing";
import {
  createBot,
  createConversation,
  createWorkspace,
  migrations as workspaceMigrations,
  resolveTenant,
  type Conversation,
  type TenantContext,
} from "@momo/workspace";
import { drizzle } from "drizzle-orm/bun-sqlite";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AttachmentFiles,
  getAttachment,
  readAttachment,
  removeWorkspaceAttachments,
  sweepAttachmentFiles,
  type NewAttachment,
} from "./attachments.ts";
import { deleteConversationRecords } from "./deletion.ts";
import { eventsAfter } from "./events.ts";
import { migrations } from "./index.ts";
import { listMessages } from "./messages.ts";
import { postOwnerMessage } from "./post-message.ts";

const now = new Date("2026-10-01T00:00:00Z");
const settings = { instructions: "手伝う", model: "sonnet", tools: [] } as const;

let testDb: TestDatabase;
let dataDir: string;
let files: AttachmentFiles;
const db = () => drizzle({ client: testDb.sqlite });
let a: TenantContext;
let b: TenantContext;
let convA: Conversation;
let convA2: Conversation;
let convB: Conversation;

function workspace(name: string): TenantContext {
  return resolveTenant(db(), createWorkspace(db(), { name, now }).id, {
    kind: "owner",
    loginId: `login_${name}`,
  })!;
}

function conversation(tenant: TenantContext): Conversation {
  const bot = createBot(db(), tenant, { ...settings, name: "Bot", tools: [], now });
  return createConversation(db(), tenant, { primaryBotId: bot.id, now })!;
}

beforeEach(() => {
  testDb = migratedTestDatabase([workspaceMigrations, migrations]);
  dataDir = mkdtempSync(join(tmpdir(), "momo-attachments-"));
  files = new AttachmentFiles(join(dataDir, "attachments"));
  a = workspace("A");
  b = workspace("B");
  convA = conversation(a);
  convA2 = conversation(a);
  convB = conversation(b);
});

afterEach(() => {
  testDb.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const newAttachment = (name: string, text = "中身", contentType = "text/plain"): NewAttachment => ({
  name,
  contentType,
  bytes: new TextEncoder().encode(text),
});

const post = (newAttachments: NewAttachment[], tenant = a, conv = convA) =>
  postOwnerMessage(db(), tenant, {
    conversationId: conv.id,
    text: "見て",
    now,
    attachments: { files, newAttachments },
  });

const mode = (path: string) => statSync(path).mode & 0o777;

/** Every path under the data dir, so a test can show nothing landed outside the expected file. */
function tree(dir = dataDir): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).toSorted();
}

describe("attaching files to an owner message", () => {
  test("stores each file owner-only in the Workspace's dir and lists it on the message", () => {
    const { message } = post([
      newAttachment("memo.txt", "旅程"),
      newAttachment("plan.html", "<p>x</p>", "text/html"),
    ])!;

    expect(message.attachments.map((x) => [x.name, x.contentType, x.size])).toEqual([
      ["memo.txt", "text/plain", 6],
      ["plan.html", "text/html", 8],
    ]);
    const [memo] = message.attachments;
    expect(memo!.id).toMatch(/^attachment_[0-9a-f-]{36}$/);
    const workspaceDir = join(dataDir, "attachments", a.workspaceId);
    expect(mode(join(dataDir, "attachments"))).toBe(0o700);
    expect(mode(workspaceDir)).toBe(0o700);
    expect(mode(join(workspaceDir, memo!.id))).toBe(0o600);
    expect(new TextDecoder().decode(readAttachment(files, a, memo!))).toBe("旅程");

    const history = listMessages(db(), a, convA.id, {})!.items;
    expect(history[0]!.attachments).toEqual(message.attachments);
    const created = eventsAfter(db(), a, convA.id, 0)[0]!.event;
    expect(created.kind === "message_created" && created.message.attachments.map((x) => x.id)).toEqual(
      message.attachments.map((x) => x.id),
    );
  });

  test("is found only through its own Workspace and Conversation", () => {
    const [mine] = post([newAttachment("memo.txt")])!.message.attachments;
    const [theirs] = post([newAttachment("secret.txt")], b, convB)!.message.attachments;

    expect(getAttachment(db(), a, { conversationId: convA.id, attachmentId: mine!.id })?.name).toBe(
      "memo.txt",
    );
    expect(getAttachment(db(), a, { conversationId: convA2.id, attachmentId: mine!.id })).toBeUndefined();
    expect(getAttachment(db(), b, { conversationId: convA.id, attachmentId: mine!.id })).toBeUndefined();
    expect(getAttachment(db(), a, { conversationId: convB.id, attachmentId: theirs!.id })).toBeUndefined();
    expect(getAttachment(db(), a, { conversationId: convA.id, attachmentId: theirs!.id })).toBeUndefined();
    expect(readAttachment(files, a, theirs!)).toBeUndefined();
  });

  test("keeps the given name out of the path, so traversal names land inside the Workspace's dir", () => {
    const names = ["../../app.db", "/etc/passwd", "..\\..\\evil.txt", "a/../../b", "..", "\u0000\n"];
    const { message } = post(names.map((n) => newAttachment(n)))!;

    expect(message.attachments.map((x) => x.name)).toEqual([
      "app.db",
      "passwd",
      "evil.txt",
      "b",
      "file",
      "file",
    ]);
    expect(tree()).toEqual(
      [
        "attachments",
        `attachments/${a.workspaceId}`,
        ...message.attachments.map((x) => `attachments/${a.workspaceId}/${x.id}`),
      ].toSorted(),
    );
  });

  test("refuses a Workspace dir that is a symlink and writes nothing", () => {
    const elsewhere = join(dataDir, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(join(dataDir, "attachments"), { mode: 0o700 });
    symlinkSync(elsewhere, join(dataDir, "attachments", a.workspaceId));

    expect(() => post([newAttachment("memo.txt")])).toThrow();
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(listMessages(db(), a, convA.id, {})!.items).toEqual([]);
  });

  test("does not follow a stored file replaced by a symlink", () => {
    const [memo] = post([newAttachment("memo.txt")])!.message.attachments;
    const path = join(dataDir, "attachments", a.workspaceId, memo!.id);
    writeFileSync(join(dataDir, "outside.txt"), "outside");
    unlinkSync(path);
    symlinkSync(join(dataDir, "outside.txt"), path);

    expect(() => readAttachment(files, a, memo!)).toThrow();
  });

  test("names an unknown or malformed content type as octet-stream", () => {
    const { message } = post([
      newAttachment("a", "x", "text/html; charset=utf-8"),
      newAttachment("b", "x", "nonsense"),
      newAttachment("c", "x", ""),
    ])!;
    expect(message.attachments.map((x) => x.contentType)).toEqual([
      "text/html",
      "application/octet-stream",
      "application/octet-stream",
    ]);
  });

  test("writes no file when the Conversation is another Workspace's", () => {
    expect(post([newAttachment("memo.txt")], a, convB)).toBeUndefined();
    expect(existsSync(join(dataDir, "attachments", a.workspaceId))).toBe(false);
    expect(existsSync(join(dataDir, "attachments", b.workspaceId))).toBe(false);
  });

  test("removes the files it wrote when the message cannot be saved", () => {
    testDb.sqlite.run(
      "CREATE TRIGGER fail_attachment BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );

    expect(() => post([newAttachment("memo.txt")])).toThrow(/Failed query/);
    expect(readdirSync(join(dataDir, "attachments", a.workspaceId))).toEqual([]);
    expect(listMessages(db(), a, convA.id, {})!.items).toEqual([]);
  });

  test("a row cannot point at another Workspace's message", () => {
    const { message } = post([])!;
    expect(() =>
      testDb.sqlite.run(
        "INSERT INTO attachments (id, workspace_id, message_id, name, content_type, size, created_at) VALUES (?, ?, ?, 'x', 'text/plain', 0, 0)",
        ["attachment_x", b.workspaceId, message.id],
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe("removing a Workspace's attachment files", () => {
  test("removes that Workspace's dir only", () => {
    post([newAttachment("memo.txt")]);
    const [theirs] = post([newAttachment("secret.txt", "B の中身")], b, convB)!.message.attachments;

    removeWorkspaceAttachments(files, a);

    expect(existsSync(join(dataDir, "attachments", a.workspaceId))).toBe(false);
    expect(new TextDecoder().decode(readAttachment(files, b, theirs!))).toBe("B の中身");
    removeWorkspaceAttachments(files, a);
  });

  test("removes a symlinked Workspace dir without touching its target", () => {
    const elsewhere = join(dataDir, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, "keep.txt"), "keep");
    mkdirSync(join(dataDir, "attachments"), { mode: 0o700 });
    symlinkSync(elsewhere, join(dataDir, "attachments", a.workspaceId));

    removeWorkspaceAttachments(files, a);

    expect(existsSync(join(dataDir, "attachments", a.workspaceId))).toBe(false);
    expect(lstatSync(join(elsewhere, "keep.txt")).isFile()).toBe(true);
  });
});

describe("sweeping Attachment files at startup", () => {
  test("removes the files whose rows a committed delete took away and keeps every file that has a row", () => {
    const gone = post([newAttachment("a.txt"), newAttachment("b.txt")])!.message.attachments;
    const [kept] = post([newAttachment("kept.txt", "残る")], a, convA2)!.message.attachments;
    const [theirs] = post([newAttachment("theirs.txt", "B の中身")], b, convB)!.message.attachments;
    deleteConversationRecords(db(), a, [convA.id]);

    expect(sweepAttachmentFiles(db(), files)).toBe(2);

    for (const x of gone) expect(existsSync(join(dataDir, "attachments", a.workspaceId, x.id))).toBe(false);
    expect(new TextDecoder().decode(readAttachment(files, a, kept!))).toBe("残る");
    expect(new TextDecoder().decode(readAttachment(files, b, theirs!))).toBe("B の中身");
    expect(sweepAttachmentFiles(db(), files)).toBe(0);
  });

  test("removes the dir of a Workspace without Attachment rows, and unlinks a symlinked one without touching its target", () => {
    post([newAttachment("memo.txt")], b, convB);
    deleteConversationRecords(db(), b, [convB.id]);
    const elsewhere = join(dataDir, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, "keep.txt"), "keep");
    symlinkSync(elsewhere, join(dataDir, "attachments", a.workspaceId));

    sweepAttachmentFiles(db(), files);

    expect(readdirSync(join(dataDir, "attachments"))).toEqual([]);
    expect(lstatSync(join(elsewhere, "keep.txt")).isFile()).toBe(true);
  });

  test("leaves names that are not Attachment or Workspace ids alone", () => {
    post([newAttachment("memo.txt")]);
    writeFileSync(join(dataDir, "attachments", "README"), "x");
    writeFileSync(join(dataDir, "attachments", a.workspaceId, "notes"), "x");

    sweepAttachmentFiles(db(), files);

    expect(existsSync(join(dataDir, "attachments", "README"))).toBe(true);
    expect(existsSync(join(dataDir, "attachments", a.workspaceId, "notes"))).toBe(true);
  });

  test("does nothing before any file was stored", () => {
    expect(sweepAttachmentFiles(db(), files)).toBe(0);
    expect(existsSync(join(dataDir, "attachments"))).toBe(false);
  });
});
