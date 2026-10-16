import { afterEach, expect, test } from "bun:test";
import { startTestBackend, type TestBackend } from "@momo/backend/testing";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const main = join(import.meta.dir, "main.ts");
let backend: TestBackend | undefined;

afterEach(async () => {
  await backend?.cleanup();
  backend = undefined;
});

async function momo(args: string[], dataDir: string) {
  const proc = Bun.spawn(["bun", main, ...args], {
    env: { ...process.env, MOMO_DATA_DIR: dataDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

test("momo open --print prints a pairing URL that logs the browser in once", async () => {
  backend = await startTestBackend();

  const { stdout, code } = await momo(["open", "--print"], backend.dataDir);

  expect(code).toBe(0);
  const url = new URL(stdout.trim());
  expect(url.origin).toBe(backend.origin);
  const token = url.hash.slice(1);
  expect((await backend.call("/api/pair", { method: "POST", body: { token } })).status).toBe(204);
  expect((await backend.call("/api/pair", { method: "POST", body: { token } })).status).toBe(401);
});

test("momo open says so when the backend is not running", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "momo-"));

  const { stderr, code } = await momo(["open", "--print"], dataDir);

  expect(code).toBe(1);
  expect(stderr).toContain("backend is not running");
  rmSync(dataDir, { recursive: true, force: true });
});
