// sendDraftToBuffer against the real migrations (PGlite) with a mocked fetch: ownership,
// idempotency, retries, the daily limit, and the exact body Buffer would receive.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import {
  countAttempts, SEND_LIMIT_PER_DAY, SEND_WINDOW_MS, sendDraftToBuffer, SENDING_STALE_MS, type SendDb, type SendDeps,
} from "@/lib/buffer/send";
import { ReconnectRequired } from "@/lib/buffer/tokens";

const client = new PGlite();
const db = drizzle(client, { schema: s });
const NOW = new Date("2026-11-02T15:00:00.000Z");
const TOKEN = "tok_FAKE_should_never_leak_1234567890abcdef";

const okBody = (id = "post_FAKE_1", dueAt: string | null = null) =>
  ({ data: { createPost: { __typename: "PostActionSuccess", post: { id, status: "draft", dueAt, externalLink: null } } } });

let fetchMock: ReturnType<typeof vi.fn>;
let respond: () => Response | Promise<Response>;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

let A: { userId: string; draftId: string; lessonId: string };
let B: { userId: string; draftId: string };

const deps = (over: Partial<SendDeps> = {}): SendDeps => ({
  db: db as unknown as SendDb, getToken: async () => TOKEN, now: () => NOW, envTestMode: undefined, ...over,
});
const send = (userId: string, input: Record<string, unknown>, over: Partial<SendDeps> = {}) =>
  sendDraftToBuffer(deps(over), userId, input);
const sentBodies = () => fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));

async function seedUser(acct: string, channels: s.BufferChannel[]) {
  const [u] = await db.insert(s.users).values({ bufferAccountId: acct, accessTokenEnc: "enc_FAKE", channelsCache: channels }).returning();
  const [p] = await db.insert(s.products).values({ userId: u.id, name: "Prompt Pantry", url: "https://example.com/p" }).returning();
  const [l] = await db.insert(s.lessons).values({ productId: p.id, term: "Few-shot", definition: "Examples first." }).returning();
  const [d] = await db.insert(s.drafts).values({
    userId: u.id, lessonId: l.id,
    perChannelText: { x: "X text\n\nPrompt Pantry — https://example.com/p", facebook: "FB text", linkedin: "LI text" },
  }).returning();
  return { userId: u.id, draftId: d.id, lessonId: l.id };
}

beforeAll(async () => { await migrate(db, { migrationsFolder: "./drizzle" }); }, 30_000);
afterAll(async () => { await client.close(); });

beforeEach(async () => {
  await client.exec("truncate users cascade");
  A = await seedUser("acctA", [
    { id: "ch_test_li", name: "A LinkedIn", service: "linkedin" },
    { id: "ch_test_x", name: "A X", service: "twitter" },
    { id: "ch_test_locked", name: "Locked FB", service: "facebook", isLocked: true },
    { id: "ch_test_ig", name: "Insta", service: "instagram" },
    { id: "ch_test_fb", name: "A Facebook Page", service: "facebook" },
    { id: "ch_test_yt", name: "A YouTube", service: "youtube" },
  ]);
  B = await seedUser("acctB", [{ id: "ch_test_b", name: "B LinkedIn", service: "linkedin" }]);
  respond = () => json(okBody());
  fetchMock = vi.fn(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const rowsFor = (draftId: string) => db.select().from(s.bufferPosts).where(eq(s.bufferPosts.draftId, draftId));

describe("happy path", () => {
  it("queue: one request with saveToDraft:true, row persisted, draft marked queued", async () => {
    const r = await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" });
    expect(r).toMatchObject({ code: "sent", lessonId: A.lessonId, postId: "post_FAKE_1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.buffer.com");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(String(init.body)).toContain('"saveToDraft":true');
    expect(sentBodies()[0].variables.input).toEqual({
      channelId: "ch_test_li", text: "LI text", schedulingType: "automatic", mode: "addToQueue", saveToDraft: true,
    });
    const [row] = await rowsFor(A.draftId);
    expect(row).toMatchObject({ bufferPostId: "post_FAKE_1", lastStatus: "draft", channelId: "ch_test_li", service: "linkedin", error: null, dueAt: null });
    const [d] = await db.select().from(s.drafts).where(eq(s.drafts.id, A.draftId));
    expect(d.status).toBe("queued");
  });

  it("custom time: server computes UTC from CT; X text for a twitter channel", async () => {
    respond = () => json(okBody("post_FAKE_2", "2026-11-10T15:00:00.000Z"));
    const r = await send(A.userId, { draftId: A.draftId, channelId: "ch_test_x", mode: "custom", local: "2026-11-10T09:00", dueAt: "1999-01-01T00:00:00Z" });
    expect(r.code).toBe("sent");
    const input = sentBodies()[0].variables.input;
    expect(input).toMatchObject({ mode: "customScheduled", dueAt: "2026-11-10T15:00:00.000Z", saveToDraft: true, text: "X text\n\nPrompt Pantry — https://example.com/p" });
    expect((await rowsFor(A.draftId))[0].dueAt?.toISOString()).toBe("2026-11-10T15:00:00.000Z");
  });

  it("a forged saveToDraft=false (and Test mode OFF) still sends saveToDraft:true", async () => {
    await db.update(s.users).set({ testMode: false }).where(eq(s.users.id, A.userId));
    const r = await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue", saveToDraft: "false", input: { saveToDraft: false } }, { envTestMode: "false" });
    expect(r.code).toBe("sent");
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain('"saveToDraft":true');
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).not.toContain('"saveToDraft":false');
  });
});

describe("ownership (no Buffer call)", () => {
  it.each([
    ["another user's draft", () => ({ draftId: B.draftId, channelId: "ch_test_li" })],
    ["another user's channel", () => ({ draftId: A.draftId, channelId: "ch_test_b" })],
    ["unknown channel", () => ({ draftId: A.draftId, channelId: "ch_nope" })],
    ["locked channel", () => ({ draftId: A.draftId, channelId: "ch_test_locked" })],
    ["unsupported service", () => ({ draftId: A.draftId, channelId: "ch_test_ig" })],
    ["non-uuid draft id", () => ({ draftId: "1 or 1=1", channelId: "ch_test_li" })],
    ["over-long channel id", () => ({ draftId: A.draftId, channelId: "c".repeat(65) })],
  ])("%s -> not_found", async (_n, input) => {
    expect((await send(A.userId, { ...input(), mode: "queue" })).code).toBe("not_found");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.select().from(s.bufferPosts)).toHaveLength(0);
  });

  it("missing text for that network -> not_found", async () => {
    await db.update(s.drafts).set({ perChannelText: { x: "x", facebook: "f", linkedin: "  " } }).where(eq(s.drafts.id, A.draftId));
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" })).code).toBe("not_found");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bad times are refused before Buffer", async () => {
    for (const [local, code] of [["2026-11-01T09:00", "time_past"], ["2027-03-14T02:30", "time_gap"], ["2028-06-01T09:00", "time_far"], ["", "time_invalid"]]) {
      expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "custom", local })).code).toBe(code);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("idempotency", () => {
  it("second send of the same draft + channel makes no second request", async () => {
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" })).code).toBe("sent");
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" })).code).toBe("already_sent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await rowsFor(A.draftId)).toHaveLength(1);
  });

  it("a double-click (concurrent sends) results in one request", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    respond = async () => { await gate; return json(okBody()); };
    const first = send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" });
    const second = send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" });
    await new Promise((r) => setTimeout(r, 50));
    release();
    const codes = (await Promise.all([first, second])).map((r) => r.code).sort();
    expect(codes).toEqual(["already_sent", "sent"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a different channel for the same draft is a separate send", async () => {
    await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" });
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_x", mode: "queue" })).code).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("failures and retry", () => {
  it("MutationError is stored sanitized; the failed row can be retried once (same row)", async () => {
    respond = () => json({ data: { createPost: { __typename: "MutationError", message: `Text too long. Bearer ${TOKEN}` } } });
    const r1 = await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" });
    expect(r1.code).toBe("rejected");
    const [failed] = await rowsFor(A.draftId);
    expect(failed).toMatchObject({ lastStatus: "failed", bufferPostId: null });
    expect(failed.error).toMatch(/Text too long/);
    expect(failed.error).not.toContain(TOKEN);
    const [d] = await db.select().from(s.drafts).where(eq(s.drafts.id, A.draftId));
    expect(d.status).toBe("draft");

    respond = () => json(okBody("post_FAKE_retry"));
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" })).code).toBe("sent");
    const rows = await rowsFor(A.draftId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: failed.id, bufferPostId: "post_FAKE_retry", error: null });
    expect(rows[0].checkedAt?.toISOString()).toBe(NOW.toISOString());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a second failure can't be retried again within 24 h (every attempt is counted)", async () => {
    respond = () => { throw new TypeError("fetch failed"); };
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" })).code).toBe("network");
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" })).code).toBe("network");
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" })).code).toBe("retry_later");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await countAttempts(db as unknown as SendDb, A.userId, new Date(NOW.getTime() - SEND_WINDOW_MS))).toBe(2);
    // 24 h later the retry is allowed again
    const later = new Date(NOW.getTime() + SEND_WINDOW_MS + 1000);
    respond = () => json(okBody());
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" }, { now: () => later })).code).toBe("sent");
  });

  it("429 records the failure and returns retryAfter", async () => {
    respond = () => json({}, 429, { "retry-after": "300" });
    const r = await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" });
    expect(r).toMatchObject({ code: "busy", retryAfter: 300 });
    expect((await rowsFor(A.draftId))[0]).toMatchObject({ lastStatus: "failed", error: expect.stringMatching(/Try again in 5 min/) });
  });

  it("401 from Buffer -> reconnect; GraphQL errors -> buffer_error; nothing leaks", async () => {
    respond = () => json({}, 401);
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" })).code).toBe("reconnect");
    respond = () => json({ errors: [{ message: `Cannot query field ${TOKEN}` }] });
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_x", mode: "queue" })).code).toBe("buffer_error");
    for (const row of await db.select().from(s.bufferPosts)) expect(row.error ?? "").not.toContain(TOKEN);
  });

  it("ReconnectRequired from the token getter -> reconnect, no row, no request", async () => {
    const r = await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" }, { getToken: async () => { throw new ReconnectRequired(); } });
    expect(r.code).toBe("reconnect");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.select().from(s.bufferPosts)).toHaveLength(0);
  });

  it("a row stuck in `sending` is already_sent until it is 10 minutes stale, then retryable", async () => {
    await db.insert(s.bufferPosts).values({ draftId: A.draftId, channelId: "ch_test_li", service: "linkedin", lastStatus: "sending", createdAt: new Date(NOW.getTime() - 60_000) });
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" })).code).toBe("already_sent");
    expect(fetchMock).not.toHaveBeenCalled();
    const later = new Date(NOW.getTime() + SENDING_STALE_MS);
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" }, { now: () => later })).code).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("daily limit", () => {
  async function seedAttempts(n: number, at: Date) {
    const [l] = await db.select().from(s.lessons).limit(1).innerJoin(s.drafts, eq(s.drafts.lessonId, s.lessons.id)).where(eq(s.drafts.userId, A.userId));
    for (let i = 0; i < n; i++) {
      const [d] = await db.insert(s.drafts).values({ userId: A.userId, lessonId: l.lessons.id, perChannelText: {} }).returning();
      await db.insert(s.bufferPosts).values({ draftId: d.id, channelId: "ch_test_li", service: "linkedin", bufferPostId: `post_FAKE_old_${i}`, createdAt: at });
    }
  }

  it(`the ${SEND_LIMIT_PER_DAY + 1}st send in 24 h is refused with no request`, async () => {
    await seedAttempts(SEND_LIMIT_PER_DAY, new Date(NOW.getTime() - 3_600_000));
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" })).code).toBe("send_limit");
    expect(fetchMock).not.toHaveBeenCalled();
    // other users are unaffected
    expect((await send(B.userId, { draftId: B.draftId, channelId: "ch_test_b", mode: "queue" })).code).toBe("sent");
  });

  it("attempts older than 24 h don't count", async () => {
    await seedAttempts(SEND_LIMIT_PER_DAY, new Date(NOW.getTime() - SEND_WINDOW_MS - 60_000));
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" })).code).toBe("sent");
  });

  it("an already-sent resend doesn't use up the limit or call Buffer", async () => {
    await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" });
    await seedAttempts(SEND_LIMIT_PER_DAY, new Date(NOW.getTime() - 60_000));
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" })).code).toBe("already_sent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("Delete my data still removes buffer_posts", () => {
  it("cascades through the new column and unique index", async () => {
    await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" });
    await db.delete(s.users).where(eq(s.users.id, A.userId));
    expect(await rowsFor(A.draftId)).toHaveLength(0);
  });
});

describe("Facebook metadata + Buffer errors (prod regression 2026-11-01)", () => {
  it("Facebook sends metadata.facebook.type='post' with saveToDraft:true", async () => {
    const r = await send(A.userId, { draftId: A.draftId, channelId: "ch_test_fb", mode: "queue" });
    expect(r.code).toBe("sent");
    expect(sentBodies()[0].variables.input).toEqual({
      channelId: "ch_test_fb", text: "FB text", schedulingType: "automatic", mode: "addToQueue", saveToDraft: true,
      metadata: { facebook: { type: "post" } },
    });
  });

  it("YouTube channels are never offered/sent (they need a video asset)", async () => {
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_yt", mode: "queue" })).code).toBe("not_found");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a Buffer MutationError is stored as Buffer's sanitized reason, and that failed row can be retried once", async () => {
    respond = () => json({ data: { createPost: { __typename: "InvalidInputError", message: `Invalid post: Facebook posts require a type (post, story, or reel). Bearer ${TOKEN}` } } });
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_fb", mode: "queue" })).code).toBe("rejected");
    const [row] = await rowsFor(A.draftId);
    expect(row.error).toContain("Facebook posts require a type (post, story, or reel)");
    expect(row.error).not.toContain(TOKEN);
    expect(row).toMatchObject({ lastStatus: "failed", bufferPostId: null, checkedAt: null });
    respond = () => json(okBody("post_FAKE_FB"));
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_fb", mode: "queue" })).code).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBodies()[1].variables.input.metadata).toEqual({ facebook: { type: "post" } });
  });

  it("HTTP 200 + errors[UNAUTHORIZED] maps to reconnect, never leaks the token", async () => {
    respond = () => json({ data: null, errors: [{ message: `Not authorized ${TOKEN}`, extensions: { code: "UNAUTHORIZED" } }] });
    expect((await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" })).code).toBe("reconnect");
    const [row] = await rowsFor(A.draftId);
    expect(row.error).toMatch(/Connect again/);
    expect(row.error).not.toContain(TOKEN);
  });

  it("HTTP 200 + errors[RATE_LIMIT_EXCEEDED] maps to busy", async () => {
    respond = () => json({ data: null, errors: [{ message: "Too many requests", extensions: { code: "RATE_LIMIT_EXCEEDED" } }] }, 200, { "retry-after": "120" });
    const r = await send(A.userId, { draftId: A.draftId, channelId: "ch_test_li", mode: "queue" });
    expect(r).toMatchObject({ code: "busy", retryAfter: 120 });
  });
});
