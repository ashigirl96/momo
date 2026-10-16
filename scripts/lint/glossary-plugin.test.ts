import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "../..");
const dir = mkdtempSync(join(tmpdir(), "momo-glossary-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function lint(fileName: string, source: string) {
  writeFileSync(join(dir, fileName), source);
  writeFileSync(
    join(dir, ".oxlintrc.json"),
    JSON.stringify({
      jsPlugins: [join(import.meta.dir, "glossary-plugin.js")],
      rules: { "glossary/avoided-term": "error" },
    }),
  );
  const run = Bun.spawnSync([join(repo, "node_modules/.bin/oxlint"), "-c", ".oxlintrc.json", fileName], {
    cwd: dir,
  });
  return [...run.stdout.toString().matchAll(/`(\w[\w-]*)` uses "([^"]+)"/g)].map(
    ([, name, term]) => `${name}:${term}`,
  );
}

test("names declared with a term the glossary avoids are reported", () => {
  expect(
    lint(
      "sample.ts",
      [
        "type TenantContext = { id: string };",
        "function ChatFrame(props: { orgId: string }) { return props; }",
        "const attachmentUpload = 1;",
      ].join("\n"),
    ),
  ).toEqual(["TenantContext:tenant", "ChatFrame:chat", "orgId:org", "attachmentUpload:upload"]);
});

test("a file name with an avoided term is reported", () => {
  expect(lint("chat-parts.ts", "export const x = 1;\n")).toEqual(["chat-parts:chat"]);
});

test("glossary terms, words allowed in code and names the code only uses pass", () => {
  expect(
    lint(
      "allowed.ts",
      [
        "type WorkspaceScope = { workspaceId: string };",
        "function openSession(request: Request, file: Blob) { return [request, file]; }",
        "const NEW_BOT_MODEL = 'sonnet';",
        "tenant.chat();",
      ].join("\n"),
    ),
  ).toEqual([]);
});
