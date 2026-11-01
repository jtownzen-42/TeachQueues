// Resolve the Postgres URL. The Vercel Neon integration can add its vars with a custom
// prefix (Jason's project uses "DATABASE_", e.g. DATABASE_POSTGRES_URL), so accept the
// common names in priority order instead of hard-requiring DATABASE_URL.
export const DB_URL_CANDIDATES = [
  "DATABASE_URL",
  "DATABASE_DATABASE_URL",
  "DATABASE_POSTGRES_URL",
  "POSTGRES_URL",
  "STORAGE_DATABASE_URL",
  "STORAGE_URL",
  "STORAGE_POSTGRES_URL",
] as const;

/**
 * pg-connection-string treats sslmode=prefer|require|verify-ca as verify-full and logs a
 * SECURITY WARNING on every cold start. Neon serves publicly trusted certificates, so we
 * ask for verify-full explicitly: same behavior, no warning. A URL that already opts into
 * libpq semantics (uselibpqcompat=true), disables TLS, or has no sslmode is left alone.
 */
export function normalizeSslMode(url: string): string {
  const m = /^([^?#]*)\?([^#]*)(#.*)?$/.exec(url);
  if (!m) return url;
  const [, base, query, hash = ""] = m;
  const parts = query.split("&");
  if (parts.some((p) => /^uselibpqcompat=true$/i.test(p))) return url;
  let changed = false;
  const next = parts.map((p) => {
    const kv = /^sslmode=(prefer|require|verify-ca)$/i.exec(p);
    if (!kv) return p;
    changed = true;
    return "sslmode=verify-full";
  });
  return changed ? `${base}?${next.join("&")}${hash}` : url;
}

export function resolveDatabaseUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  for (const k of DB_URL_CANDIDATES) {
    const v = env[k]?.trim();
    if (v) return normalizeSslMode(v);
  }
  // Last resort: the integration's no-SSL variant, upgraded to verified TLS.
  const noSsl = (env.DATABASE_POSTGRES_URL_NO_SSL ?? env.POSTGRES_URL_NO_SSL)?.trim();
  if (noSsl) return noSsl + (noSsl.includes("?") ? "&" : "?") + "sslmode=verify-full";
  return undefined;
}
