// Unauthenticated reachability probe for the Buffer API host.
// No user token, no client secret, no Authorization header.

/** Same host the app uses for GraphQL (`src/lib/buffer/api.ts`). */
export const BUFFER_HEALTH_URL = "https://api.buffer.com";
export const BUFFER_HEALTH_TIMEOUT_MS = 3000;

export type BufferHealth = { reachable: boolean; latencyMs: number };

export type PingBufferOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  url?: string;
};

/**
 * Lightweight unauthenticated request to the Buffer API host.
 * Any HTTP response (including 4xx/5xx) means the host is reachable.
 * Timeouts and network errors are reported as unreachable.
 */
export async function pingBufferApi(opts: PingBufferOptions = {}): Promise<BufferHealth> {
  const fetchFn = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? BUFFER_HEALTH_TIMEOUT_MS;
  const url = opts.url ?? BUFFER_HEALTH_URL;
  const started = now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    void res.status;
    return { reachable: true, latencyMs: Math.max(0, now() - started) };
  } catch {
    return { reachable: false, latencyMs: Math.max(0, now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

export type HealthPayload = {
  status: "ok";
  app: "teachqueue";
  time: string;
  buffer: BufferHealth;
};

export function healthPayload(buffer: BufferHealth, time = new Date()): HealthPayload {
  return { status: "ok", app: "teachqueue", time: time.toISOString(), buffer };
}

export type BadgePayload = {
  schemaVersion: 1;
  label: "Buffer API";
  message: "healthy" | "unreachable";
  color: "brightgreen" | "red";
};

export function badgePayload(buffer: BufferHealth): BadgePayload {
  return buffer.reachable
    ? { schemaVersion: 1, label: "Buffer API", message: "healthy", color: "brightgreen" }
    : { schemaVersion: 1, label: "Buffer API", message: "unreachable", color: "red" };
}

export const BADGE_CACHE_CONTROL = "public, max-age=60, s-maxage=60";
export const HEALTH_CACHE_CONTROL = "no-store";
