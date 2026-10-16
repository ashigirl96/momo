import type { MigrationSource } from "@momo/migrator";
import { fileURLToPath } from "node:url";

export const migrations: MigrationSource = {
  domain: "workspace",
  dir: fileURLToPath(new URL("../migrations", import.meta.url)),
};

export * from "./bots.ts";
export * from "./conversations.ts";
export { bots, conversationParticipants, conversations } from "./schema.ts";
export * from "./logins.ts";
export * from "./paging.ts";
export * from "./scoped.ts";
export * from "./workspace-scope.ts";
export * from "./workspaces.ts";
