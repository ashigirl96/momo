import { z } from "zod";

export * from "./local.ts";

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
