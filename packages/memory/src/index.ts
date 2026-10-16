import type { MigrationSource } from "@momo/migrator";
import { fileURLToPath } from "node:url";

export const migrations: MigrationSource = {
  domain: "memory",
  dir: fileURLToPath(new URL("../migrations", import.meta.url)),
};

export {
  deleteBotMemory,
  deleteMemoryItem,
  deleteWorkspaceMemory,
  detachMemoryFromConversation,
  getMemoryItem,
  listMemoryItems,
  searchMemoryItems,
  writeMemoryItem,
  type MemoryRecord,
  type MemoryRow,
} from "./items.ts";

export { toMemoryHit, toMemoryItem } from "./wire.ts";
