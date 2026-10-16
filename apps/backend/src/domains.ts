import { migrations as agent } from "@momo/agent";
import { migrations as connections } from "@momo/connections";
import { migrations as memory } from "@momo/memory";
import type { MigrationSource } from "@momo/migrator";
import { migrations as workspace } from "@momo/workspace";

/** Every domain whose migrations go into app.db. A domain name never changes once released. */
export const appDbDomains: MigrationSource[] = [workspace, agent, memory, connections];
