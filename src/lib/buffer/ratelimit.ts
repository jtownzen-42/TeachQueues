// Buffer's structured rate-limit headers, per window, plus the guard that pauses live reads when the
// shared app budget runs low. Pure: no server-only imports, never throws on bad input.
// Verified against the live docs 2026-11-02: https://developers.buffer.com/guides/api-limits.md
//   ("Using Response Headers to check Rate Limits" + "Handling errors caused by rate limiting").
//   Every authenticated response carries three of each header, one per window (example values; the
//   quotas and therefore the names depend on the plan / app client):
//     RateLimit:        "150-in-15min";r=98;t=897            (also "600-in-1day", "3000-in-30days")
//     RateLimit-Policy: "150-in-15min";q=150;w=900;pk=:ZjJjZjVmNzM5M2Zm:
//   On a 429 the docs show the spaced form: "150-in-15min"; r=0; t=753 (+ Retry-After = t).
//   fetch() joins repeated headers into one comma-separated string; we split on "," (pk is base64
//   between colons, so it never contains a comma) and then on ";", trimming spaces, so the unspaced,
//   spaced, comma-joined and single-line forms all parse the same.
// Windows are identified by their length `w` in seconds (900 = 15 min, 86400 = 24 h, 2592000 = 30 days),
// as the docs instruct, not by name; names are only used to join RateLimit to RateLimit-Policy
// within the same response.

export type RateLimitWindow = { w: number; q?: number; r?: number; t?: number };

/** Remaining below this share of a fresh window's quota counts as "low". */
export const QUOTA_LOW_RATIO = 0.2;

type Entry = { name: string | null; params: Record<string, string> };

function entries(raw: string | null | undefined): Entry[] {
  if (!raw || typeof raw !== "string") return [];
  const out: Entry[] = [];
  for (const chunk of raw.split(",")) {
    const parts = chunk.split(";").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    let name: string | null = null;
    const params: Record<string, string> = {};
    for (const p of parts) {
      const eq = p.indexOf("=");
      if (eq === -1) { name = p.replace(/^"+|"+$/g, "").trim() || null; continue; }
      const k = p.slice(0, eq).trim().toLowerCase();
      const v = p.slice(eq + 1).trim().replace(/^"+|"+$/g, "");
      if (k && !(k in params)) params[k] = v;
    }
    out.push({ name, params });
  }
  return out;
}

const int = (v: string | undefined): number | undefined => {
  if (v === undefined || !/^\d{1,12}$/.test(v)) return undefined;
  return Number(v);
};

/** All windows in the headers, matched by name between RateLimit and RateLimit-Policy and keyed by `w`.
 *  Tolerant of spacing and quotes; ignores `pk` and anything unknown; never throws. */
export function parseRateLimitWindows(headers: Pick<Headers, "get"> | null | undefined): RateLimitWindow[] {
  try {
    const policy = entries(headers?.get("ratelimit-policy"));
    const live = entries(headers?.get("ratelimit"));
    const byW = new Map<number, RateLimitWindow>();
    const nameToW = new Map<string, number>();
    for (const p of policy) {
      const w = int(p.params.w);
      if (!w) continue;
      const win: RateLimitWindow = { w };
      const q = int(p.params.q);
      if (q !== undefined) win.q = q;
      byW.set(w, win);
      if (p.name) nameToW.set(p.name, w);
    }
    for (const l of live) {
      const w = l.name ? nameToW.get(l.name) : int(l.params.w);
      if (!w) continue;
      const win = byW.get(w) ?? { w };
      const r = int(l.params.r);
      const t = int(l.params.t);
      if (r !== undefined) win.r = r;
      if (t !== undefined) win.t = t;
      byW.set(w, win);
    }
    return [...byW.values()].sort((a, b) => a.w - b.w);
  } catch {
    return [];
  }
}

export type RateLimitRow = { windowSeconds: number; quota: number | null; remaining: number | null; resetAt: Date | null; busyUntil: Date | null };
export type RateLimitState = {
  low: boolean;
  busyUntil: Date | null;
  lowest: { w: number; remaining: number; quota: number; resetAt: Date } | null;
};

/** Guard state from the stored windows. Rows past their reset time are unknown (not low).
 *  low = some fresh window has remaining / quota < 0.20; busyUntil = latest future busy_until. */
export function rateLimitState(rows: RateLimitRow[], now: Date): RateLimitState {
  let lowest: RateLimitState["lowest"] = null;
  let busyUntil: Date | null = null;
  for (const r of rows) {
    if (r.busyUntil && r.busyUntil.getTime() > now.getTime() && (!busyUntil || r.busyUntil > busyUntil)) busyUntil = r.busyUntil;
    const fresh = r.resetAt && r.resetAt.getTime() > now.getTime();
    if (!fresh || !r.quota || r.quota <= 0 || r.remaining === null || r.remaining < 0) continue;
    if (!lowest || r.remaining / r.quota < lowest.remaining / lowest.quota) {
      lowest = { w: r.windowSeconds, remaining: r.remaining, quota: r.quota, resetAt: r.resetAt! };
    }
  }
  const low = Boolean(lowest && lowest.remaining / lowest.quota < QUOTA_LOW_RATIO);
  return { low, busyUntil, lowest };
}
