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

export function resolveDatabaseUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  for (const k of DB_URL_CANDIDATES) {
    const v = env[k]?.trim();
    if (v) return v;
  }
  // Last resort: the integration's no-SSL variant, upgraded to require TLS.
  const noSsl = (env.DATABASE_POSTGRES_URL_NO_SSL ?? env.POSTGRES_URL_NO_SSL)?.trim();
  if (noSsl) return noSsl + (noSsl.includes("?") ? "&" : "?") + "sslmode=require";
  return undefined;
}
