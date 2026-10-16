import type { MigrationSource } from "@momo/migrator";
import { fileURLToPath } from "node:url";

export const migrations: MigrationSource = {
  domain: "memory",
  dir: fileURLToPath(new URL("../migrations", import.meta.url)),
};
