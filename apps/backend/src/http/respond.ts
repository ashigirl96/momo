import type { ApiError, ErrorKind } from "@momo/contracts";

const STATUS: Record<ErrorKind, number> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
};

export function json(body: unknown, init: ResponseInit = {}): Response {
  const res = Response.json(body, init);
  res.headers.set("cache-control", "no-store");
  return res;
}

export function apiError(kind: ErrorKind, message: string): Response {
  const body: ApiError = { error: { kind, message } };
  return json(body, { status: STATUS[kind] });
}

export function noContent(headers?: HeadersInit): Response {
  return new Response(null, { status: 204, headers });
}
