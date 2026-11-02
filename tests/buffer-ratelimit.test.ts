import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRateLimitWindows, QUOTA_LOW_RATIO, rateLimitState, type RateLimitRow } from "@/lib/buffer/ratelimit";
import { BufferApiError, bufferGraphQL, bufferGraphQLWithMeta } from "@/lib/buffer/api";
import { deskNoticesFrom } from "@/lib/notices";

// The exact examples from https://developers.buffer.com/guides/api-limits.md (fetch joins repeated headers with ", ").
const RL = `"100-in-15min"; r=98; t=897, "500-in-1day"; r=498; t=86397, "10000-in-30days"; r=9990; t=2591997`;
const POLICY = `"100-in-15min"; q=100; w=900; pk=:Zm9vYmFy:, "500-in-1day"; q=500; w=86400; pk=:YmF6:, "10000-in-30days"; q=10000; w=2592000; pk=:cXV4:`;
const h = (o: Record<string, string>) => new Headers(o);

describe("parseRateLimitWindows", () => {
  it("parses the three documented windows by w", () => {
    expect(parseRateLimitWindows(h({ RateLimit: RL, "RateLimit-Policy": POLICY }))).toEqual([
      { w: 900, q: 100, r: 98, t: 897 },
      { w: 86400, q: 500, r: 498, t: 86397 },
      { w: 2592000, q: 10000, r: 9990, t: 2591997 },
    ]);
  });
  it("matches by window, not by order or name format; tolerant of spacing", () => {
    const rl = `"500-in-1day";r=7;t=10,"100-in-15min" ;  r=3 ; t=5`;
    const pol = ` "100-in-15min";q=100;w=900 , "500-in-1day" ; q=500 ; w=86400 ; pk=:x,y:`;
    const out = parseRateLimitWindows(h({ ratelimit: rl, "ratelimit-policy": pol }));
    expect(out.find((w) => w.w === 900)).toMatchObject({ q: 100, r: 3, t: 5 });
    expect(out.find((w) => w.w === 86400)).toMatchObject({ q: 500, r: 7, t: 10 });
  });
  it("never throws on garbage", () => {
    for (const g of [{}, { RateLimit: "garbage;;,,,=", "RateLimit-Policy": "w=abc; q=-1" }, { RateLimit: RL }, { "RateLimit-Policy": "\"x\"; w=0" }]) {
      expect(() => parseRateLimitWindows(h(g as Record<string, string>))).not.toThrow();
    }
    expect(parseRateLimitWindows(null)).toEqual([]);
    expect(parseRateLimitWindows(h({ RateLimit: RL }))).toEqual([]); // no policy -> no windows to match
  });
});

describe("rateLimitState", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const later = new Date(now.getTime() + 600_000);
  const row = (o: Partial<RateLimitRow>): RateLimitRow => ({ windowSeconds: 900, quota: 100, remaining: 50, resetAt: later, busyUntil: null, ...o });
  it("low below 20%, not low at exactly 20%", () => {
    expect(QUOTA_LOW_RATIO).toBe(0.2);
    expect(rateLimitState([row({ remaining: 19 })], now).low).toBe(true);
    expect(rateLimitState([row({ remaining: 20 })], now).low).toBe(false);
    expect(rateLimitState([row({ windowSeconds: 86400, quota: 500, remaining: 99 }), row({ remaining: 90 })], now)).toMatchObject({ low: true, lowest: { w: 86400, remaining: 99, quota: 500 } });
  });
  it("stale rows (past reset) and rows without quota count as unknown", () => {
    expect(rateLimitState([row({ remaining: 1, resetAt: new Date(now.getTime() - 1) })], now)).toEqual({ low: false, busyUntil: null, lowest: null });
    expect(rateLimitState([row({ quota: null, remaining: 1 })], now).low).toBe(false);
  });
  it("busyUntil only when in the future", () => {
    expect(rateLimitState([row({ windowSeconds: 0, quota: null, remaining: null, resetAt: null, busyUntil: later })], now).busyUntil).toEqual(later);
    expect(rateLimitState([row({ busyUntil: new Date(now.getTime() - 1) })], now).busyUntil).toBeNull();
  });
});

describe("bufferGraphQLWithMeta / bufferGraphQL", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("returns data plus windows; bufferGraphQL returns only data (unchanged)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { ok: 1 } }), { status: 200, headers: { RateLimit: RL, "RateLimit-Policy": POLICY } })));
    const r = await bufferGraphQLWithMeta<{ ok: number }>("tok_FAKE", "query X { x }");
    expect(r.data).toEqual({ ok: 1 });
    expect(r.windows.map((w) => w.w)).toEqual([900, 86400, 2592000]);
    expect(await bufferGraphQL("tok_FAKE", "query X { x }")).toEqual({ ok: 1 });
  });
  it("429 keeps the same BufferApiError mapping and attaches windows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "Too many", extensions: { code: "RATE_LIMIT_EXCEEDED", window: "15m" } }] }), { status: 429, headers: { "Retry-After": "120", RateLimit: RL, "RateLimit-Policy": POLICY } })));
    const e = await bufferGraphQLWithMeta("tok_FAKE", "query X { x }").catch((x) => x);
    expect(e).toBeInstanceOf(BufferApiError);
    expect([e.status, e.retryAfter]).toEqual([429, 120]);
    expect(e.windows).toHaveLength(3);
  });
  it("busy notice shows the minutes (120 s -> 2 min)", () => {
    expect(deskNoticesFrom({ n: "busy", wait: String(Math.ceil(120 / 60)) })[0].text).toMatch(/Try again in 2 min/);
  });
});

describe("review: exact header formats from developers.buffer.com/guides/api-limits.md (2026-11-02)", () => {
  const expected = [
    { w: 900, q: 150, r: 98, t: 897 },
    { w: 86400, q: 600, r: 598, t: 86397 },
    { w: 2592000, q: 3000, r: 2969, t: 696980 },
  ];
  const RL = ['"150-in-15min";r=98;t=897', '"600-in-1day";r=598;t=86397', '"3000-in-30days";r=2969;t=696980'];
  const POL = ['"150-in-15min";q=150;w=900;pk=:ZjJjZjVmNzM5M2Zm:', '"600-in-1day";q=600;w=86400;pk=:ZjJjZjVmNzM5M2Zm:', '"3000-in-30days";q=3000;w=2592000;pk=:ZjJjZjVmNzM5M2Zm:'];

  it("three separate header lines (as the API sends them) -> three windows keyed by w", () => {
    const h = new Headers();
    for (const v of RL) h.append("RateLimit", v);
    for (const v of POL) h.append("RateLimit-Policy", v);
    expect(parseRateLimitWindows(h)).toEqual(expected);
  });
  it("comma-joined, no spaces", () => {
    const h = new Headers({ RateLimit: RL.join(","), "RateLimit-Policy": POL.join(",") });
    expect(parseRateLimitWindows(h)).toEqual(expected);
  });
  it("comma-joined with a space after every ; and ,", () => {
    const sp = (a: string[]) => a.map((x) => x.replace(/;/g, "; ")).join(", ");
    const h = new Headers({ RateLimit: sp(RL), "RateLimit-Policy": sp(POL) });
    expect(parseRateLimitWindows(h)).toEqual(expected);
  });
  it("the documented 429 headers (spaced, one policy) -> that window exhausted", () => {
    const h = new Headers({ ratelimit: '"150-in-15min"; r=0; t=753', "ratelimit-policy": '"150-in-15min"; q=150; w=900; pk=:ZjJjZjVmNzM5M2Zm:' });
    expect(parseRateLimitWindows(h)).toEqual([{ w: 900, q: 150, r: 0, t: 753 }]);
  });
  it("order of windows in RateLimit differs from RateLimit-Policy -> still joined correctly", () => {
    const h = new Headers({ RateLimit: [...RL].reverse().join(", "), "RateLimit-Policy": POL.join(", ") });
    expect(parseRateLimitWindows(h)).toEqual(expected);
  });
});
