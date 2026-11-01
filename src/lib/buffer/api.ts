import "server-only";

export const BUFFER_API_URL = "https://api.buffer.com";

export type RateLimitInfo = { remaining?: number; limit?: number; resetSeconds?: number; policy?: string };

export class BufferApiError extends Error {
  constructor(message: string, public status: number, public retryAfter?: number, public rateLimit?: RateLimitInfo) {
    super(message);
  }
  name = "BufferApiError";
}

/** Retry-After is seconds or an HTTP date; fall back to 60s when unparseable. */
export function parseRetryAfter(v: string | null, now = Date.now()): number {
  if (!v) return 60;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - now) / 1000)) : 60;
}

/** Parse IETF RateLimit headers, e.g. `RateLimit: limit=100, remaining=97, reset=812`. */
export function parseRateLimit(headers: Headers): RateLimitInfo {
  const info: RateLimitInfo = {};
  const raw = headers.get("ratelimit");
  if (raw) {
    for (const part of raw.split(/[,;]/)) {
      const [k, v] = part.trim().split("=");
      const n = Number(v);
      if (k === "limit" || k === "l") info.limit = n;
      if (k === "remaining" || k === "r") info.remaining = n;
      if (k === "reset" || k === "t") info.resetSeconds = n;
    }
  }
  const rem = headers.get("ratelimit-remaining") ?? headers.get("x-ratelimit-remaining");
  if (rem && info.remaining === undefined) info.remaining = Number(rem);
  const policy = headers.get("ratelimit-policy");
  if (policy) info.policy = policy;
  return info;
}

export let lastRateLimit: RateLimitInfo = {};

export async function bufferGraphQL<T>(accessToken: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  lastRateLimit = parseRateLimit(res.headers);
  if (res.status === 429) {
    const ra = parseRetryAfter(res.headers.get("retry-after"));
    throw new BufferApiError("Buffer is busy (rate limited). Try again shortly.", 429, ra, lastRateLimit);
  }
  if (res.status === 401) throw new BufferApiError("Buffer session expired. Please reconnect.", 401);
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || json.errors?.length) {
    throw new BufferApiError(json.errors?.map((e) => e.message).join("; ") || `Buffer API error ${res.status}`, res.status);
  }
  return json.data as T;
}

export const ACCOUNT_QUERY = /* GraphQL */ `
  query TeachQueueAccount { account { id email name timezone organizations { id name } } }
`;

export const CHANNELS_QUERY = /* GraphQL */ `
  query TeachQueueChannels($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) { id name displayName service descriptor avatar isDisconnected isLocked }
  }
`;

export type AccountData = {
  account: { id: string; email?: string | null; name?: string | null; timezone?: string | null; organizations: { id: string; name: string }[] };
};
export type ChannelsData = {
  channels: {
    id: string; name: string; displayName?: string | null; service: string; descriptor?: string;
    avatar?: string | null; isDisconnected?: boolean; isLocked?: boolean;
  }[];
};
