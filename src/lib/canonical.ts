// Canonical-host redirect (pure, so it is unit-testable and Edge-safe).
// OAuth cookies are host-scoped and Buffer checks redirect_uri exactly, so every
// production request must be served from the host in BUFFER_REDIRECT_URI.

/** Production aliases Vercel assigns besides the canonical one. */
export const KNOWN_ALIAS_HOSTS = ["teachqueue.vercel.app", "teachqueue-jt-techs.vercel.app"];
export const DEFAULT_CANONICAL_HOST = "teachqueue-app.vercel.app";

export function canonicalHostFrom(redirectUri: string | undefined): string {
  try {
    if (redirectUri) {
      const u = new URL(redirectUri.trim());
      if (u.protocol === "https:" && u.hostname !== "localhost") return u.host;
    }
  } catch { /* fall through */ }
  return DEFAULT_CANONICAL_HOST;
}

/** Returns the absolute URL to 308 to, or null to serve the request as-is.
 * Only production is touched, and only the known alias hosts, so preview and
 * per-deployment URLs keep working. */
export function canonicalRedirectUrl(opts: {
  host: string | null | undefined;
  pathname: string;
  search: string;
  vercelEnv: string | undefined;
  redirectUri: string | undefined;
}): string | null {
  if (opts.vercelEnv !== "production" || !opts.host) return null;
  const host = opts.host.toLowerCase().split(",")[0].trim();
  const canonical = canonicalHostFrom(opts.redirectUri).toLowerCase();
  if (host === canonical || !KNOWN_ALIAS_HOSTS.includes(host)) return null;
  return `https://${canonical}${opts.pathname}${opts.search}`;
}
