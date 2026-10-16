import { LOGIN_TTL_MS } from "@momo/workspace";

// No Secure / __Host- prefix: not every target browser was shown to keep them on http://momo.localhost.
export const LOGIN_COOKIE = "momo_login";

export function readLoginToken(req: Request): string {
  return new Bun.CookieMap(req.headers.get("cookie") ?? "").get(LOGIN_COOKIE) ?? "";
}

export function loginCookie(token: string): string {
  return `${LOGIN_COOKIE}=${token}; Path=/; Max-Age=${LOGIN_TTL_MS / 1000}; HttpOnly; SameSite=Strict`;
}

export function clearedLoginCookie(): string {
  return `${LOGIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`;
}
