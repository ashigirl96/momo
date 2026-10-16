import type { Database } from "bun:sqlite";

type Column = { name: string; notnull: number };
type ForeignKey = { id: number; seq: number; table: string; from: string; to: string };
type Index = { name: string; unique: number };

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * Lists every way a table with a `workspace_id` column breaks the Workspace-owned table rules.
 * Run it over a migrated database so a new table, or a recreate that dropped a trigger, is caught.
 */
export function workspaceOwnedTableProblems(sqlite: Database): string[] {
  const tables = sqlite
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((t) => t.name);
  const columnsOf = (table: string) => sqlite.query<Column, []>(`PRAGMA table_info(${quote(table)})`).all();
  const owned = new Set(tables.filter((t) => columnsOf(t).some((c) => c.name === "workspace_id")));

  const problems: string[] = [];
  for (const table of owned) {
    if (!columnsOf(table).find((c) => c.name === "workspace_id")!.notnull)
      problems.push(`${table}: workspace_id is nullable`);

    const foreignKeys = Map.groupBy(
      sqlite.query<ForeignKey, []>(`PRAGMA foreign_key_list(${quote(table)})`).all(),
      (fk) => fk.id,
    );
    const fks = [...foreignKeys.values()];
    if (!fks.some((fk) => fk.length === 1 && fk[0]!.table === "workspaces" && fk[0]!.from === "workspace_id"))
      problems.push(`${table}: workspace_id does not reference workspaces(id)`);
    for (const fk of fks) {
      if (!owned.has(fk[0]!.table)) continue;
      if (!fk.some((col) => col.from === "workspace_id" && col.to === "workspace_id"))
        problems.push(`${table}: references ${fk[0]!.table} without (workspace_id, id)`);
    }

    const keys = sqlite
      .query<Index, []>(`PRAGMA index_list(${quote(table)})`)
      .all()
      .filter((index) => index.unique)
      .map((index) =>
        sqlite
          .query<{ name: string }, []>(`PRAGMA index_info(${quote(index.name)})`)
          .all()
          .map((c) => c.name)
          .join(","),
      );
    if (!keys.includes("workspace_id,id")) problems.push(`${table}: no UNIQUE (workspace_id, id)`);

    const trigger = sqlite
      .query<{ sql: string }, [string]>(
        "SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ? AND sql LIKE '%BEFORE UPDATE OF `workspace_id`%'",
      )
      .get(table);
    if (!trigger?.sql.includes("RAISE(ABORT")) problems.push(`${table}: workspace_id can be updated`);
  }
  return problems;
}
