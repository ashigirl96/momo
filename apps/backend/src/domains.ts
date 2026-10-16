import { migrations as agent } from "@momo/agent";
import { migrations as connections } from "@momo/connections";
import { migrations as memory } from "@momo/memory";
import type { MigrationSource } from "@momo/migrator";
import { migrations as workspace } from "@momo/workspace";

/** A domain name never changes once released, because applied migrations are keyed on it. */
export const appDbDomains: MigrationSource[] = [workspace, agent, memory, connections];
