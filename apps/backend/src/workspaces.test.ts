import { afterEach, describe, expect, test } from "bun:test";
import { ApiError, WorkspaceItem, WorkspaceList } from "@momo/contracts";
import { workspaceOwnedTableProblems } from "@momo/workspace/testing";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { startTestBackend, type TestBackend } from "./testing.ts";

let b: TestBackend;

afterEach(async () => {
  await b.cleanup();
});

async function create(cookie: string, name: string): Promise<WorkspaceItem> {
  const res = await b.call("/api/workspaces", { method: "POST", cookie, body: { name } });
  expect(res.status).toBe(201);
  return WorkspaceItem.parse(await res.json());
}

async function names(cookie: string): Promise<string[]> {
  const res = await b.call("/api/workspaces", { cookie });
  return WorkspaceList.parse(await res.json()).workspaces.map((w) => w.name);
}

async function errorKind(res: Response): Promise<string> {
  return ApiError.parse(await res.json()).error.kind;
}

describe("Workspace API", () => {
  test("a created Workspace is listed, opened by its path and survives a backend restart", async () => {
    b = await startTestBackend();
    const cookie = await b.login();

    const personal = await create(cookie, "個人");
    const work = await create(cookie, "会社 A");
    expect(await names(cookie)).toEqual(["個人", "会社 A"]);

    b = await b.restart();
    expect(await names(cookie)).toEqual(["個人", "会社 A"]);
    const opened = await b.call(`/api/workspaces/${work.id}`, { cookie });
    expect(WorkspaceItem.parse(await opened.json())).toEqual(work);
    expect(personal.id).not.toBe(work.id);
  });

  test("an unknown or malformed Workspace id in the path is 404, never another Workspace", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    await create(cookie, "個人");

    for (const id of [`workspace_${Bun.randomUUIDv7()}`, "default", "%20", "workspace_"]) {
      const res = await b.call(`/api/workspaces/${id}`, { cookie });
      expect(res.status).toBe(404);
      expect(await errorKind(res)).toBe("not_found");
    }
  });

  test("a Workspace id in the query is refused; the path alone names the Workspace", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const a = await create(cookie, "A");
    const other = await create(cookie, "B");

    for (const query of [`workspaceId=${other.id}`, `workspace_id=${other.id}`, `workspaceId=${a.id}`]) {
      const res = await b.call(`/api/workspaces/${a.id}?${query}`, { cookie });
      expect(res.status).toBe(400);
    }
  });

  test("a create request that names an id or Workspace id is refused and creates nothing", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const a = await create(cookie, "A");

    for (const body of [
      { name: "B", workspaceId: a.id },
      { name: "B", id: a.id },
    ]) {
      const res = await b.call("/api/workspaces", { method: "POST", cookie, body });
      expect(res.status).toBe(400);
    }
    expect(await names(cookie)).toEqual(["A"]);
  });

  test("names are trimmed, and empty or overlong names are refused", async () => {
    b = await startTestBackend();
    const cookie = await b.login();

    expect((await create(cookie, "  個人 ")).name).toBe("個人");
    for (const name of ["", "   ", "x".repeat(51)]) {
      const res = await b.call("/api/workspaces", { method: "POST", cookie, body: { name } });
      expect(res.status).toBe(400);
    }
  });

  test("Workspaces are not readable or creatable without a Login", async () => {
    b = await startTestBackend();
    const cookie = await b.login();
    const a = await create(cookie, "A");

    expect((await b.call("/api/workspaces")).status).toBe(401);
    expect((await b.call(`/api/workspaces/${a.id}`)).status).toBe(401);
    expect((await b.call("/api/workspaces", { method: "POST", body: { name: "B" } })).status).toBe(401);
    expect(await names(cookie)).toEqual(["A"]);
  });
});

test("every Workspace-owned table in app.db follows the (workspace_id, id) rules", async () => {
  b = await startTestBackend();
  const sqlite = new Database(join(b.dataDir, "app.db"), { readonly: true });
  try {
    expect(workspaceOwnedTableProblems(sqlite)).toEqual([]);
  } finally {
    sqlite.close();
  }
});
