import type { MigrationSource } from "@momo/migrator";
import { fileURLToPath } from "node:url";

export const migrations: MigrationSource = {
  domain: "agent",
  dir: fileURLToPath(new URL("../migrations", import.meta.url)),
};

export { eventsAfter, streamAfter, type StoredEvent } from "./events.ts";
export { listMessages, toMessageItem, type Message, type MessageAuthor } from "./messages.ts";
export { postOwnerMessage } from "./post-message.ts";
export {
  appendRunDelta,
  cancelRun,
  failInterruptedRuns,
  finishRun,
  getRun,
  startNextRun,
  toRunItem,
  type QueuedSession,
  type Run,
  type StartedRun,
} from "./runs.ts";
export {
  getSession,
  listSessions,
  resetSession,
  toSessionItem,
  updateBotSettings,
  type Session,
} from "./sessions.ts";
