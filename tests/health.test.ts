import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BADGE_CACHE_CONTROL,
  badgePayload,
  BUFFER_HEALTH_TIMEOUT_MS,
  BUFFER_HEALTH_URL,
  HEALTH_CACHE_CONTROL,
  healthPayload,
  pingBufferApi,
} from "@/lib/health/buffer";
import { GET as healthGet } from "@/app/api/health/route";
import { GET as badgeGet } from "@/app/api/health/badge/route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function jsonResponse(status = 401) {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("pingBufferApi", () => {
  it("treats any HTTP response as reachable and records latency", async () => {
    let t = 1_000;
    const fetchFn = vi.fn(async () => {
      t += 42;
      return jsonResponse(401);
    });
    const result = await pingBufferApi({ fetch: fetchFn, now: () => t });
    expect(result).toEqual({ reachable: true, latencyMs: 42 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(BUFFER_HEALTH_URL);
    expect(init.method).toBe("GET");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("Authorization")).toBeNull();
  });

  it("reports unreachable on network failure, with latency", async () => {
    let t = 5_000;
    const fetchFn = vi.fn(async () => {
      t += 17;
      throw new Error("connect failed");
    });
    await expect(pingBufferApi({ fetch: fetchFn, now: () => t })).resolves.toEqual({
      reachable: false,
      latencyMs: 17,
    });
  });

  it("aborts after the default 3s timeout and does not send secrets", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });
    const pending = pingBufferApi({ fetch: fetchFn as unknown as typeof fetch, now: Date.now });
    await vi.advanceTimersByTimeAsync(BUFFER_HEALTH_TIMEOUT_MS);
    await expect(pending).resolves.toMatchObject({ reachable: false });
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(JSON.stringify(init)).not.toMatch(/Bearer |client_secret|BUFFER_CLIENT/i);
  });
});

describe("health and badge payloads", () => {
  it("health payload is always app-ok and includes ISO time plus buffer stats", () => {
    const time = new Date("2026-11-12T17:00:00.000Z");
    expect(healthPayload({ reachable: false, latencyMs: 9 }, time)).toEqual({
      status: "ok",
      app: "teachqueue",
      time: "2026-11-12T17:00:00.000Z",
      buffer: { reachable: false, latencyMs: 9 },
    });
  });

  it("badge payload maps reachability to shields.io fields", () => {
    expect(badgePayload({ reachable: true, latencyMs: 12 })).toEqual({
      schemaVersion: 1,
      label: "Buffer API",
      message: "healthy",
      color: "brightgreen",
    });
    expect(badgePayload({ reachable: false, latencyMs: 3000 })).toEqual({
      schemaVersion: 1,
      label: "Buffer API",
      message: "unreachable",
      color: "red",
    });
  });
});

describe("health route handlers", () => {
  it("GET /api/health returns 200 JSON and does not cache", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200)));
    const res = await healthGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(HEALTH_CACHE_CONTROL);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.app).toBe("teachqueue");
    expect(typeof body.time).toBe("string");
    expect(Number.isFinite(Date.parse(body.time))).toBe(true);
    expect(body.buffer).toEqual({ reachable: true, latencyMs: expect.any(Number) });
    expect(body.buffer.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("GET /api/health/badge returns a shields.io payload with a 60s cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    const res = await badgeGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(BADGE_CACHE_CONTROL);
    await expect(res.json()).resolves.toEqual({
      schemaVersion: 1,
      label: "Buffer API",
      message: "unreachable",
      color: "red",
    });
  });
});
