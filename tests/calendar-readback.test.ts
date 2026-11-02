// readBackStatuses on PGlite with a mocked fetch (real bufferGraphQLWithMeta underneath).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { countAttempts, SEND_WINDOW_MS, type SendDb } from "@/lib/buffer/send";
import { ReconnectRequired } from "@/lib/buffer/tokens";
import { AUTO_READ_AFTER_MS, MAX_READ_PAGES, readBackStatuses, REFRESH_COOLDOWN_MS, type ReadDeps } from "@/lib/calendar/readback";
import { loadCalendarItems } from "@/lib/calendar/items";

const client = new PGlite();
const db = drizzle(client, { schema: s });
const sdb = db as unknown as SendDb;
const NOW = new Date("2026-11-02T15:00:00.000Z");
const RL = `"100-in-15min"; r=98; t=897, "500-in-1day"; r=498; t=86397`;
const POLICY = `"100-in-15min"; q=100; w=900; pk=:a:, "500-in-1day"; q=500; w=86400; pk=:b:`;

type Node = { id: string; channelId: string; status?: string; dueAt?: string | null; sentAt?: string | null; externalLink?: string | null; error?: { message: string } | null };
let pages: { nodes: Node[]; hasNextPage?: boolean; endCursor?: string | null }[];
let responder: ((i: number) => Response) | null;
let fetchMock: ReturnType<typeof vi.fn>;
let sleep: ReturnType<typeof vi.fn>;
let A: { userId: string; draftId: string; lessonId: string };
let B: { userId: string; draftId: string };

const pageResponse = (i: number) => {
  const p = pages[Math.min(i, pages.length - 1)];
  return new Response(JSON.stringify({ data: { posts: { edges: p.nodes.map((node) => ({ node: { status: "draft", dueAt: null, sentAt: null, externalLink: null, error: null, ...node } })), pageInfo: { hasNextPage: p.hasNextPage ?? false, endCursor: p.endCursor ?? null } } } }), { status: 200, headers: { "content-type": "application/json", RateLimit: RL, "RateLimit-Policy": POLICY } });
};
const deps = (over: Partial<ReadDeps> = {}): ReadDeps => ({ db: sdb, getToken: async () => "tok_FAKE", now: () => NOW, sleep: sleep as unknown as ReadDeps["sleep"], ...over });
const read = (userId: string, trigger: "auto" | "manual" = "manual", over: Partial<ReadDeps> = {}) => readBackStatuses(deps(over), userId, { trigger });
const bodies = () => fetchMock.mock.calls.map((c) => String((c[1] as RequestInit).body));
const rowById = async (id: string) => (await db.select().from(s.bufferPosts).where(eq(s.bufferPosts.id, id)))[0];

async function seed(acct: string, channel: string, org: string | null = "org_test_1") {
  const [u] = await db.insert(s.users).values({ bufferAccountId: acct, accessTokenEnc: "enc_FAKE", orgId: org, channelsCache: [{ id: channel, name: `${acct} LinkedIn`, service: "linkedin" }] }).returning();
  const [p] = await db.insert(s.products).values({ userId: u.id, name: "Prompt Pantry", url: "https://example.com/kit" }).returning();
  const [l] = await db.insert(s.lessons).values({ productId: p.id, term: "Few-shot", definition: "Examples first." }).returning();
  const [d] = await db.insert(s.drafts).values({ userId: u.id, lessonId: l.id, status: "queued", perChannelText: { x: "X", facebook: "F", linkedin: "LinkedIn text for the calendar" } }).returning();
  return { userId: u.id, draftId: d.id, lessonId: l.id };
}
async function sentRow(draftId: string, postId: string, channelId: string, extra: Partial<typeof s.bufferPosts.$inferInsert> = {}) {
  const [r] = await db.insert(s.bufferPosts).values({ draftId, bufferPostId: postId, channelId, service: "linkedin", lastStatus: "draft", createdAt: new Date(NOW.getTime() - 3_600_000), ...extra }).returning();
  return r;
}
/** Extra drafts so we can have many sent rows (unique draft x channel). */
async function manySent(n: number, channelId = "ch_test_1") {
  const out = [];
  for (let i = 0; i < n; i++) {
    const [d] = await db.insert(s.drafts).values({ userId: A.userId, lessonId: A.lessonId, status: "queued", perChannelText: { linkedin: `t${i}` } }).returning();
    out.push(await sentRow(d.id, `post_test_${i}`, channelId));
  }
  return out;
}

beforeAll(async () => { await migrate(db, { migrationsFolder: "./drizzle" }); }, 30_000);
afterAll(async () => { await client.close(); });
beforeEach(async () => {
  await client.exec("truncate users cascade; truncate buffer_rate_limits");
  A = await seed("acctA", "ch_test_1");
  B = await seed("acctB", "ch_test_b");
  pages = [{ nodes: [] }];
  responder = null;
  let i = 0;
  fetchMock = vi.fn(async () => (responder ? responder(i++) : pageResponse(i++)));
  vi.stubGlobal("fetch", fetchMock);
  sleep = vi.fn(async () => {});
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("one request, the right query", () => {
  it("<= 50 posts: exactly one read-only request; statuses written to the cache columns only", async () => {
    const row = await sentRow(A.draftId, "post_test_1", "ch_test_1", { checkedAt: new Date(NOW.getTime() - 1000), dueAt: new Date("2026-11-09T15:00:00Z") });
    const before = await rowById(row.id);
    const attemptsBefore = await countAttempts(sdb, A.userId, new Date(NOW.getTime() - SEND_WINDOW_MS));
    pages = [{ nodes: [{ id: "post_test_1", channelId: "ch_test_1", status: "sent", dueAt: "2026-11-10T15:00:00Z", sentAt: "2026-11-10T15:00:04Z", externalLink: "https://www.linkedin.com/feed/update/9" }] }];
    const r = await read(A.userId);
    expect(r).toMatchObject({ code: "read_ok", requests: 1, matched: 1, missing: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(bodies()[0]);
    expect(body.query).toMatch(/^\s*query /);
    expect(body.variables).toEqual({ organizationId: "org_test_1", channelIds: ["ch_test_1"], startDate: new Date(NOW.getTime() - 3_600_000 - 86_400_000).toISOString(), first: 50 });
    const after = await rowById(row.id);
    expect(after).toMatchObject({ bufferStatus: "sent", bufferError: null, externalLink: "https://www.linkedin.com/feed/update/9", bufferMissingAt: null });
    expect(after.dueAt?.toISOString()).toBe("2026-11-10T15:00:00.000Z");
    expect(after.sentAt?.toISOString()).toBe("2026-11-10T15:00:04.000Z");
    expect(after.bufferSyncedAt?.toISOString()).toBe(NOW.toISOString());
    // send-path columns byte-identical
    for (const k of ["checkedAt", "createdAt", "lastStatus", "error", "bufferPostId", "draftId", "channelId"] as const) expect(after[k]).toEqual(before[k]);
    expect(await countAttempts(sdb, A.userId, new Date(NOW.getTime() - SEND_WINDOW_MS))).toBe(attemptsBefore);
    const [u] = await db.select().from(s.users).where(eq(s.users.id, A.userId));
    expect([u.postsReadAt?.toISOString(), u.postsReadAttemptAt?.toISOString()]).toEqual([NOW.toISOString(), NOW.toISOString()]);
  });

  it("every request body is a query: no mutation, no saveToDraft", async () => {
    await manySent(3);
    pages = [{ nodes: [], hasNextPage: true, endCursor: "c1" }, { nodes: [], hasNextPage: true, endCursor: "c2" }, { nodes: [] }];
    await read(A.userId);
    expect(bodies().length).toBeGreaterThan(0);
    for (const b of bodies()) { expect(b).not.toMatch(/mutation/i); expect(b).not.toContain("saveToDraft"); }
  });

  it("another user's posts are never updated or put in channelIds; same id on another channel is ignored", async () => {
    const mine = await sentRow(A.draftId, "post_test_1", "ch_test_1");
    const theirs = await sentRow(B.draftId, "post_test_1", "ch_test_b");
    pages = [{ nodes: [
      { id: "post_test_1", channelId: "ch_test_b", status: "sent" },     // B's channel: ignored for A
      { id: "post_test_1", channelId: "ch_test_1", status: "scheduled" }, // A's
    ] }];
    expect((await read(A.userId)).code).toBe("read_ok");
    expect(JSON.parse(bodies()[0]).variables.channelIds).toEqual(["ch_test_1"]);
    expect((await rowById(mine.id)).bufferStatus).toBe("scheduled");
    expect((await rowById(theirs.id)).bufferStatus).toBeNull();
    expect((await rowById(theirs.id)).bufferSyncedAt).toBeNull();
  });
});

describe("pagination", () => {
  it("stops as soon as every id is matched", async () => {
    await manySent(2);
    pages = [{ nodes: [{ id: "post_test_0", channelId: "ch_test_1", status: "sent" }, { id: "post_test_1", channelId: "ch_test_1" }], hasNextPage: true, endCursor: "c1" }];
    expect(await read(A.userId)).toMatchObject({ code: "read_ok", requests: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("follows endCursor while ids are unmatched; caps at MAX_READ_PAGES; no not-found when incomplete", async () => {
    const rows = await manySent(3);
    pages = [
      { nodes: [{ id: "post_test_0", channelId: "ch_test_1", status: "sent" }], hasNextPage: true, endCursor: "c1" },
      { nodes: [{ id: "post_test_1", channelId: "ch_test_1", status: "sent" }], hasNextPage: true, endCursor: "c2" },
      { nodes: [], hasNextPage: true, endCursor: "c3" },
      { nodes: [{ id: "post_test_2", channelId: "ch_test_1" }] },
    ];
    const r = await read(A.userId);
    expect(r).toMatchObject({ code: "read_partial", requests: MAX_READ_PAGES, matched: 2, missing: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(bodies()[1]).variables.after).toBe("c1");
    expect(JSON.parse(bodies()[2]).variables.after).toBe("c2");
    expect((await rowById(rows[2].id)).bufferMissingAt).toBeNull(); // "not read this time"
  });
  it("marks not found only after a complete scan, and clears it when seen again", async () => {
    const [r0, r1] = await manySent(2);
    pages = [{ nodes: [{ id: "post_test_0", channelId: "ch_test_1", status: "sent" }], hasNextPage: false }];
    expect(await read(A.userId)).toMatchObject({ code: "read_ok", missing: 1 });
    expect((await rowById(r1.id)).bufferMissingAt?.toISOString()).toBe(NOW.toISOString());
    expect((await rowById(r0.id)).bufferMissingAt).toBeNull();
    const later = new Date(NOW.getTime() + REFRESH_COOLDOWN_MS + 1);
    pages = [{ nodes: [{ id: "post_test_0", channelId: "ch_test_1" }, { id: "post_test_1", channelId: "ch_test_1", status: "scheduled" }] }];
    await read(A.userId, "manual", { now: () => later });
    expect((await rowById(r1.id)).bufferMissingAt).toBeNull();
    expect((await rowById(r1.id)).bufferStatus).toBe("scheduled");
  });
  it("unknown status keeps the previous one; error message is stored sanitized", async () => {
    const row = await sentRow(A.draftId, "post_test_1", "ch_test_1", { bufferStatus: "scheduled" });
    pages = [{ nodes: [{ id: "post_test_1", channelId: "ch_test_1", status: "archived", error: { message: "Oops Bearer tok_FAKE_abcdefghijklmnopqrstuvwxyz0123456789" } }] }];
    await read(A.userId);
    const after = await rowById(row.id);
    expect(after.bufferStatus).toBe("scheduled");
    expect(after.bufferError).toMatch(/^Oops/);
    expect(after.bufferError).not.toContain("tok_FAKE");
  });
});

describe("when not to read (zero fetches)", () => {
  it("manual refresh within 60 s -> refresh_cooldown", async () => {
    await sentRow(A.draftId, "post_test_1", "ch_test_1");
    await db.update(s.users).set({ postsReadAttemptAt: new Date(NOW.getTime() - REFRESH_COOLDOWN_MS + 1000) }).where(eq(s.users.id, A.userId));
    expect(await read(A.userId)).toEqual({ code: "refresh_cooldown", requests: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("auto read skipped when the last read is < 10 min old; runs when older", async () => {
    await sentRow(A.draftId, "post_test_1", "ch_test_1");
    await db.update(s.users).set({ postsReadAt: new Date(NOW.getTime() - AUTO_READ_AFTER_MS + 60_000), postsReadAttemptAt: new Date(NOW.getTime() - AUTO_READ_AFTER_MS + 60_000) }).where(eq(s.users.id, A.userId));
    expect((await read(A.userId, "auto")).code).toBe("not_due");
    expect(fetchMock).not.toHaveBeenCalled();
    await db.update(s.users).set({ postsReadAt: new Date(NOW.getTime() - AUTO_READ_AFTER_MS - 1), postsReadAttemptAt: new Date(NOW.getTime() - AUTO_READ_AFTER_MS - 1) }).where(eq(s.users.id, A.userId));
    expect((await read(A.userId, "auto")).code).toBe("read_ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("nothing sent / no org / no token -> no fetch", async () => {
    expect((await read(A.userId)).code).toBe("nothing_to_read");
    await sentRow(A.draftId, "post_test_1", "ch_test_1");
    await db.update(s.users).set({ orgId: null }).where(eq(s.users.id, A.userId));
    expect((await read(A.userId)).code).toBe("nothing_to_read");
    await db.update(s.users).set({ orgId: "org_test_1", accessTokenEnc: null }).where(eq(s.users.id, A.userId));
    expect((await read(A.userId)).code).toBe("reconnect");
    // a failed send (no Buffer post id) is nothing to read
    await db.update(s.users).set({ accessTokenEnc: "enc_FAKE" }).where(eq(s.users.id, B.userId));
    await db.insert(s.bufferPosts).values({ draftId: B.draftId, channelId: "ch_test_b", service: "linkedin", lastStatus: "failed", error: "x" });
    expect((await read(B.userId)).code).toBe("nothing_to_read");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("rate limit and errors", () => {
  it("windows from the response are stored app-wide", async () => {
    await sentRow(A.draftId, "post_test_1", "ch_test_1");
    await read(A.userId);
    const rows = await db.select().from(s.bufferRateLimits).orderBy(s.bufferRateLimits.windowSeconds);
    expect(rows.map((r) => [r.windowSeconds, r.quota, r.remaining])).toEqual([[900, 100, 98], [86400, 500, 498]]);
    expect(rows[0].resetAt?.toISOString()).toBe(new Date(NOW.getTime() + 897_000).toISOString());
  });
  it("low quota (< 20% of a fresh window) -> quota_low, no fetch; exactly 20% still reads", async () => {
    await sentRow(A.draftId, "post_test_1", "ch_test_1");
    await db.insert(s.bufferRateLimits).values({ windowSeconds: 86400, quota: 500, remaining: 99, resetAt: new Date(NOW.getTime() + 3_600_000) });
    expect(await read(A.userId)).toEqual({ code: "quota_low", requests: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    await db.update(s.bufferRateLimits).set({ remaining: 100 });
    expect((await read(A.userId)).code).toBe("read_ok");
  });
  it("429 with Retry-After 3 -> waits once (sleep 3000) and retries the same request", async () => {
    await sentRow(A.draftId, "post_test_1", "ch_test_1");
    pages = [{ nodes: [{ id: "post_test_1", channelId: "ch_test_1", status: "sent" }] }];
    responder = (i) => (i === 0 ? new Response("{}", { status: 429, headers: { "Retry-After": "3" } }) : pageResponse(0));
    const r = await read(A.userId);
    expect(r).toMatchObject({ code: "read_ok", requests: 2 });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(JSON.parse(bodies()[0]).variables).toEqual(JSON.parse(bodies()[1]).variables);
  });
  it("429 with Retry-After 120 -> busy (retryAfter 120), busy_until stored, no retry; next read is blocked", async () => {
    await sentRow(A.draftId, "post_test_1", "ch_test_1");
    responder = () => new Response(JSON.stringify({ errors: [{ extensions: { code: "RATE_LIMIT_EXCEEDED", window: "15m" } }] }), { status: 429, headers: { "Retry-After": "120" } });
    expect(await read(A.userId)).toMatchObject({ code: "busy", retryAfter: 120, requests: 1 });
    expect(sleep).not.toHaveBeenCalled();
    const [marker] = await db.select().from(s.bufferRateLimits).where(eq(s.bufferRateLimits.windowSeconds, 0));
    expect(marker.busyUntil?.toISOString()).toBe(new Date(NOW.getTime() + 120_000).toISOString());
    const later = new Date(NOW.getTime() + REFRESH_COOLDOWN_MS + 1);
    expect(await read(A.userId, "manual", { now: () => later })).toMatchObject({ code: "busy", requests: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("401 and GraphQL UNAUTHORIZED -> reconnect; ReconnectRequired from the token -> reconnect", async () => {
    await sentRow(A.draftId, "post_test_1", "ch_test_1");
    responder = () => new Response("{}", { status: 401 });
    expect((await read(A.userId)).code).toBe("reconnect");
    const t2 = new Date(NOW.getTime() + 2 * REFRESH_COOLDOWN_MS);
    responder = () => new Response(JSON.stringify({ errors: [{ message: "nope", extensions: { code: "UNAUTHORIZED" } }] }), { status: 200 });
    expect((await read(A.userId, "manual", { now: () => t2 })).code).toBe("reconnect");
    const t3 = new Date(NOW.getTime() + 4 * REFRESH_COOLDOWN_MS);
    expect((await read(A.userId, "manual", { now: () => t3, getToken: async () => { throw new ReconnectRequired(); } })).code).toBe("reconnect");
  });
  it("network failure -> read_failed; the attempt still starts the cooldown", async () => {
    await sentRow(A.draftId, "post_test_1", "ch_test_1");
    responder = () => { throw new TypeError("fetch failed"); };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await read(A.userId)).code).toBe("read_failed");
    spy.mockRestore();
    expect((await read(A.userId)).code).toBe("refresh_cooldown");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("calendar items", () => {
  it("only the user's rows; sent rows per channel plus local-only drafts; View post only for https", async () => {
    await sentRow(A.draftId, "post_test_1", "ch_test_1", { bufferStatus: "sent", externalLink: "https://www.linkedin.com/feed/update/9" });
    const [d2] = await db.insert(s.drafts).values({ userId: A.userId, lessonId: A.lessonId, perChannelText: { linkedin: "A newer local draft" } }).returning();
    await sentRow(B.draftId, "post_test_2", "ch_test_b", { bufferStatus: "sent" });
    const items = await loadCalendarItems(sdb, A.userId, [{ id: "ch_test_1", name: "A LinkedIn", service: "linkedin" }]);
    expect(items.map((i) => [i.status.label, i.channelName, i.source.label, i.viewPost])).toEqual(expect.arrayContaining([
      ["Sent", "A LinkedIn", "Lesson: Few-shot", "https://www.linkedin.com/feed/update/9"],
      ["Draft", null, "Lesson: Few-shot", null],
    ]));
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.key === d2.id)?.excerpt).toBe("A newer local draft");
    expect(JSON.stringify(items)).not.toContain("post_test_2");
  });
});

describe("delete my data", () => {
  it("still removes buffer_posts (with the new columns) and results", async () => {
    await sentRow(A.draftId, "post_test_1", "ch_test_1", { bufferStatus: "sent", bufferSyncedAt: NOW });
    const [p] = await db.select().from(s.products).where(eq(s.products.userId, A.userId));
    const [c] = await db.insert(s.campaigns).values({ userId: A.userId, productId: p.id, name: "C" }).returning();
    await db.insert(s.results).values({ campaignId: c.id, day: "2026-11-01", revenue: "12.30" });
    await db.delete(s.users).where(eq(s.users.id, A.userId));
    expect(await db.select().from(s.bufferPosts).where(eq(s.bufferPosts.draftId, A.draftId))).toHaveLength(0);
    expect(await db.select().from(s.results)).toHaveLength(0);
    expect(await db.select().from(s.drafts).where(eq(s.drafts.userId, B.userId))).toHaveLength(1);
  });
});

describe("review hardening: cooldown is claimed atomically", () => {
  it("two concurrent manual refreshes -> exactly one Buffer request; the other gets refresh_cooldown", async () => {
    await sentRow(A.draftId, "post_test_1", "ch_test_1");
    pages = [{ nodes: [{ id: "post_test_1", channelId: "ch_test_1", status: "scheduled" }] }];
    const results = await Promise.all([read(A.userId), read(A.userId), read(A.userId)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.code).sort()).toEqual(["read_ok", "refresh_cooldown", "refresh_cooldown"]);
  });
  it("concurrent page loads (auto) and a refresh -> one Buffer request in total", async () => {
    await sentRow(A.draftId, "post_test_1", "ch_test_1");
    pages = [{ nodes: [{ id: "post_test_1", channelId: "ch_test_1", status: "sent" }] }];
    await Promise.all([read(A.userId, "auto"), read(A.userId, "auto"), read(A.userId, "manual")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("a refresh exactly 60 s after the last attempt is allowed", async () => {
    await sentRow(A.draftId, "post_test_1", "ch_test_1");
    await db.update(s.users).set({ postsReadAttemptAt: new Date(NOW.getTime() - REFRESH_COOLDOWN_MS) }).where(eq(s.users.id, A.userId));
    expect((await read(A.userId)).code).toBe("read_ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
