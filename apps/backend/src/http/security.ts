export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};

export function withSecurityHeaders(res: Response): Response {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.headers.set(name, value);
  return res;
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method);
}

/**
 * Refuses requests a page on another origin could have caused.
 * Returns undefined when the request may proceed.
 */
export function crossOriginRefusal(req: Request, origin: string): string | undefined {
  const site = req.headers.get("sec-fetch-site");
  if (isSafeMethod(req.method)) {
    if (site === "cross-site" || site === "same-site") return "cross-site read";
    return undefined;
  }
  if (req.headers.get("origin") !== origin) return "Origin does not match";
  if (site !== "same-origin") return "Sec-Fetch-Site is not same-origin";
  return undefined;
}
