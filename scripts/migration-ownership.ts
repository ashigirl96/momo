import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type MigrationDir = { domain: string; dir: string };

type Statement = { domain: string; folder: string; verb: string; table: string };

const HEADS: [verb: string, pattern: RegExp][] = [
  ["CREATE TABLE", /^CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)/i],
  ["DROP TABLE", /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)/i],
  ["ALTER TABLE", /^ALTER\s+TABLE\s+[`"]?(\w+)/i],
  ["CREATE INDEX", /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+[\s\S]*?\bON\s+[`"]?(\w+)/i],
  ["CREATE TRIGGER", /^CREATE\s+TRIGGER\s+[\s\S]*?\bON\s+[`"]?(\w+)/i],
];

const RECREATE = "__new_";

function statements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((part) =>
      part
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

function parse({ domain, dir }: MigrationDir): Statement[] {
  return readdirSync(dir)
    .filter((folder) => existsSync(join(dir, folder, "migration.sql")))
    .flatMap((folder) =>
      statements(readFileSync(join(dir, folder, "migration.sql"), "utf8")).flatMap((text) => {
        for (const [verb, pattern] of HEADS) {
          const table = pattern.exec(text)?.[1];
          if (table) return [{ domain, folder, verb, table: table.replace(RECREATE, "") }];
        }
        return [];
      }),
    );
}

/** A table belongs to the domain that creates it first in the migrator's (folder, domain) order. */
export function migrationOwnershipProblems(dirs: MigrationDir[]): string[] {
  const all = dirs
    .flatMap(parse)
    .toSorted((a, b) => a.folder.localeCompare(b.folder) || a.domain.localeCompare(b.domain));
  const owner = new Map<string, string>();
  for (const s of all) if (s.verb === "CREATE TABLE" && !owner.has(s.table)) owner.set(s.table, s.domain);
  return all.flatMap((s) => {
    const by = owner.get(s.table);
    if (by === s.domain) return [];
    const problem = by ? `is owned by ${by}` : "is not created by any domain";
    return [`${s.domain}/${s.folder}: ${s.verb} \`${s.table}\` ${problem}`];
  });
}

export function repoMigrationDirs(): MigrationDir[] {
  const packages = join(import.meta.dir, "..", "packages");
  return readdirSync(packages).flatMap((name) =>
    [
      { domain: name, dir: join(packages, name, "migrations") },
      { domain: `${name}/fixture`, dir: join(packages, name, "fixture", "migrations") },
    ].filter(({ dir }) => existsSync(dir)),
  );
}

if (import.meta.main) {
  const problems = migrationOwnershipProblems(repoMigrationDirs());
  for (const problem of problems) console.log(problem);
  if (problems.length > 0) process.exit(1);
}
