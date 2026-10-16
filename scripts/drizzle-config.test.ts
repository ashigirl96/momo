import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const packages = join(import.meta.dir, "..", "packages");
const configs = readdirSync(packages)
  .toSorted()
  .map((name) => join(packages, name, "drizzle.config.ts"))
  .filter((path) => Bun.file(path).size > 0);

test("only domains that own tables have a drizzle.config.ts", () => {
  expect(configs.map((path) => path.split("/").at(-2))).toEqual(["workspace"]);
});

test.each(configs)("%s gives drizzle-kit no database to push to", async (path) => {
  const config = (await import(path)).default;

  expect(config).not.toHaveProperty("dbCredentials");
  expect(config).not.toHaveProperty("driver");
  expect(config.out).toBe("./migrations");
});
