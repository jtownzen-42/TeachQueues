// Small request helpers shared by route handlers (no server-only deps, so testable).

/** CSRF defense in depth for state-changing POSTs (cookies are already SameSite=Lax).
 * Browsers send Origin on cross-origin POSTs; reject when it doesn't match our host.
 * A missing Origin (very old browsers, curl) is allowed: Lax cookies still protect it. */
export function isSameOrigin(headers: Headers, selfOrigin: string): boolean {
  const origin = headers.get("origin");
  if (!origin || origin === "null") return origin !== "null";
  try {
    return new URL(origin).host === new URL(selfOrigin).host;
  } catch {
    return false;
  }
}

/** A path on our own origin with the given notice params, for 303 redirects home. */
export function homeUrl(origin: string, params: Record<string, string> = {}): URL {
  const u = new URL("/", origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u;
}
