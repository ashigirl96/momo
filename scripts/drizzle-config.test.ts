import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const packages = join(import.meta.dir, "..", "packages");
const existing = (paths: string[]) => paths.filter((path) => Bun.file(path).size > 0);
const names = readdirSync(packages).toSorted();
const domainConfigs = existing(names.map((name) => join(packages, name, "drizzle.config.ts")));
const fixtureConfigs = existing(names.map((name) => join(packages, name, "fixture", "drizzle.config.ts")));

test("only domains that own tables have a drizzle.config.ts", () => {
  expect(domainConfigs.map((path) => path.split("/").at(-2))).toEqual(["agent", "memory", "workspace"]);
});

test.each([...domainConfigs, ...fixtureConfigs])(
  "%s gives drizzle-kit no database to push to",
  async (path) => {
    const config = (await import(path)).default;

    expect(config).not.toHaveProperty("dbCredentials");
    expect(config).not.toHaveProperty("driver");
    expect(config.out).toBe("./migrations");
  },
);
