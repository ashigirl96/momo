import { LoginList, Status, type PairRequest } from "@momo/contracts";
import type { z } from "zod";

export class Unauthenticated extends Error {}

async function request<T>(
  path: string,
  schema: z.ZodType<T> | undefined,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: init.body ? { "content-type": "application/json" } : undefined,
  });
  if (res.status === 401) throw new Unauthenticated();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} failed with ${res.status}`);
  return schema ? schema.parse(await res.json()) : (undefined as T);
}

export const api = {
  status: () => request("/api/status", Status),
  pair: (body: PairRequest) =>
    request("/api/pair", undefined, { method: "POST", body: JSON.stringify(body) }),
  logins: () => request("/api/logins", LoginList),
  revokeLogin: (id: string) =>
    request(`/api/logins/${encodeURIComponent(id)}`, undefined, { method: "DELETE" }),
};
