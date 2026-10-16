import { z } from "zod";

export * from "./bots.ts";
export * from "./conversations.ts";
export * from "./deletion.ts";
export * from "./events.ts";
export * from "./local.ts";
export * from "./mailbox.ts";
export * from "./memory.ts";
export * from "./messages.ts";
export * from "./runs.ts";
export * from "./sessions.ts";

const epochMs = z.int().nonnegative();

export const PairRequest = z.strictObject({
  token: z.string().min(1).max(256),
});
export type PairRequest = z.infer<typeof PairRequest>;

export const LoginItem = z.strictObject({
  id: z.string(),
  userAgent: z.string(),
  createdAt: epochMs,
  lastUsedAt: epochMs,
  expiresAt: epochMs,
  current: z.boolean(),
});
export type LoginItem = z.infer<typeof LoginItem>;

export const LoginList = z.strictObject({
  logins: z.array(LoginItem),
});
export type LoginList = z.infer<typeof LoginList>;

export const WORKSPACE_NAME_MAX = 50;

export const WorkspaceItem = z.strictObject({
  id: z.string(),
  name: z.string(),
  createdAt: epochMs,
});
export type WorkspaceItem = z.infer<typeof WorkspaceItem>;

export const WorkspaceList = z.strictObject({
  workspaces: z.array(WorkspaceItem),
});
export type WorkspaceList = z.infer<typeof WorkspaceList>;

/** The backend assigns the id; a request naming one is refused. */
export const CreateWorkspaceRequest = z.strictObject({
  name: z.string().trim().min(1).max(WORKSPACE_NAME_MAX),
});
export type CreateWorkspaceRequest = z.input<typeof CreateWorkspaceRequest>;

export const Warning = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("filevault_off") }),
  z.strictObject({ kind: z.literal("time_machine_not_excluded") }),
]);
export type Warning = z.infer<typeof Warning>;

export const Status = z.strictObject({
  loginId: z.string(),
  warnings: z.array(Warning),
});
export type Status = z.infer<typeof Status>;

export const ErrorKind = z.enum([
  "unauthenticated",
  "forbidden",
  "not_found",
  "bad_request",
  "method_not_allowed",
]);
export type ErrorKind = z.infer<typeof ErrorKind>;

export const ApiError = z.strictObject({
  error: z.strictObject({ kind: ErrorKind, message: z.string() }),
});
export type ApiError = z.infer<typeof ApiError>;

/** What `momo open` receives from the backend over the owner-only Unix socket. */
export const Pairing = z.strictObject({
  url: z.url(),
  expiresAt: epochMs,
});
export type Pairing = z.infer<typeof Pairing>;
