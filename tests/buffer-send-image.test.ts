// "Send to Buffer as draft" with the saved lesson graphic attached (PGlite + mocked fetch).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { sendDraftToBuffer, type SendDb, type SendDeps } from "@/lib/buffer/send";
import { cardModelHash, lessonCardModel } from "@/lib/graphics/card";

const client = new PGlite();
const db = drizzle(client, { schema: s });
const NOW = new Date("2026-11-02T15:00:00.000Z");
const IMG = "https://fake.public.blob.vercel-storage.com/teachqueue/lessons/x.png";

let A: { userId: string; draftId: string; lessonId: string; productId: string };
let head: () => Response;
let fetchMock: ReturnType<typeof vi.fn>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = () => json({ data: { createPost: { __typename: "PostActionSuccess", post: { id: "post_FAKE_1", status: "draft", dueAt: null, externalLink: null } } } });
const deps = (): SendDeps => ({ db: db as unknown as SendDb, getToken: async () => "tok_FAKE", now: () => NOW, envTestMode: undefined });
const send = (input: Record<string, unknown>) => sendDraftToBuffer(deps(), A.userId, { draftId: A.draftId, mode: "queue", ...input });
const bufferCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("https://api.buffer.com"));
const headCalls = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "HEAD");
const bufferInput = (i = 0) => JSON.parse(String((bufferCalls()[i][1] as RequestInit).body)).variables.input;

async function currentHash() {
  const [row] = await db.select({ lesson: s.lessons, product: s.products }).from(s.lessons)
    .innerJoin(s.products, eq(s.products.id, s.lessons.productId)).where(eq(s.lessons.id, A.lessonId));
  return cardModelHash(lessonCardModel(row));
}
async function saveImage(hash?: string) {
  await db.update(s.drafts).set({ imageUrl: IMG, imageHash: hash ?? (await currentHash()), imageSavedAt: NOW }).where(eq(s.drafts.id, A.draftId));
}

beforeAll(async () => { await migrate(db, { migrationsFolder: "./drizzle" }); }, 30_000);
afterAll(async () => { await client.close(); });
beforeEach(async () => {
  await client.exec("truncate users cascade");
  const [u] = await db.insert(s.users).values({
    bufferAccountId: "acctA", accessTokenEnc: "enc_FAKE",
    channelsCache: [
      { id: "ch_test_li", name: "LI", service: "linkedin" },
      { id: "ch_test_fb", name: "FB", service: "facebook" },
      { id: "ch_test_x", name: "X", service: "twitter" },
    ],
  }).returning();
  const [p] = await db.insert(s.products).values({ userId: u.id, name: "Prompt Pantry", url: "https://example.com/p", brandColors: ["#2563eb"] }).returning();
  const [l] = await db.insert(s.lessons).values({ productId: p.id, term: "Few-shot", definition: "Examples first." }).returning();
  const [d] = await db.insert(s.drafts).values({ userId: u.id, lessonId: l.id, perChannelText: { x: "X text", facebook: "FB text", linkedin: "LI text" } }).returning();
  A = { userId: u.id, draftId: d.id, lessonId: l.id, productId: p.id };
  head = () => new Response(null, { status: 200, headers: { "content-type": "image/png" } });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => (init?.method === "HEAD" && url === IMG ? head() : ok()));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("send with the saved image", () => {
  it("current image + attachImage=yes -> assets with the DB URL, saveToDraft:true, HEAD first", async () => {
    await saveImage();
    expect((await send({ channelId: "ch_test_li", attachImage: "yes" })).code).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headCalls()).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe(IMG); // HEAD before the Buffer request
    expect(bufferInput()).toEqual({
      channelId: "ch_test_li", text: "LI text", schedulingType: "automatic", mode: "addToQueue", saveToDraft: true,
      assets: [{ image: { url: IMG } }],
    });
  });

  it("Facebook keeps metadata.facebook.type = post alongside the image (no linkAttachment)", async () => {
    await saveImage();
    expect((await send({ channelId: "ch_test_fb", attachImage: "yes" })).code).toBe("sent");
    const input = bufferInput();
    expect(input.metadata).toEqual({ facebook: { type: "post" } });
    expect(input.assets).toEqual([{ image: { url: IMG } }]);
    expect(input.saveToDraft).toBe(true);
    expect(JSON.stringify(input)).not.toContain("linkAttachment");
  });

  it("without the checkbox -> no assets key and no HEAD", async () => {
    await saveImage();
    expect((await send({ channelId: "ch_test_li" })).code).toBe("sent");
    expect(bufferInput()).not.toHaveProperty("assets");
    expect(headCalls()).toHaveLength(0);
    // only the literal "yes" attaches
    expect((await send({ channelId: "ch_test_fb", attachImage: "on" })).code).toBe("sent");
    expect(bufferInput(1)).not.toHaveProperty("assets");
    expect(headCalls()).toHaveLength(0);
  });

  it("a stale hash (lesson changed since saving) -> no assets, no HEAD", async () => {
    await saveImage();
    await db.update(s.lessons).set({ term: "Changed term" }).where(eq(s.lessons.id, A.lessonId));
    expect((await send({ channelId: "ch_test_li", attachImage: "yes" })).code).toBe("sent");
    expect(bufferInput()).not.toHaveProperty("assets");
    expect(headCalls()).toHaveLength(0);
  });

  it("a non-Blob URL in the database is never attached", async () => {
    await db.update(s.drafts).set({ imageUrl: "https://evil.example/x.png", imageHash: await currentHash() }).where(eq(s.drafts.id, A.draftId));
    expect((await send({ channelId: "ch_test_li", attachImage: "yes" })).code).toBe("sent");
    expect(bufferInput()).not.toHaveProperty("assets");
  });

  it("forged imageUrl / assets form fields are ignored", async () => {
    const forged = { channelId: "ch_test_li", attachImage: "yes", imageUrl: "https://evil.example/a.png", assets: [{ image: { url: "https://evil.example/b.png" } }], saveToDraft: false };
    expect((await send(forged)).code).toBe("sent"); // no saved image -> text only
    expect(bufferInput()).not.toHaveProperty("assets");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("evil.example");
    expect(bufferInput().saveToDraft).toBe(true);
  });

  it.each([
    ["404", () => new Response(null, { status: 404 })],
    ["not an image", () => new Response(null, { status: 200, headers: { "content-type": "text/html" } })],
    ["redirect", () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } })],
  ])("HEAD %s -> image_unreachable: one fetch (the HEAD), no Buffer request, no buffer_posts row", async (_n, res) => {
    await saveImage();
    head = res;
    expect((await send({ channelId: "ch_test_li", attachImage: "yes" })).code).toBe("image_unreachable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(headCalls()).toHaveLength(1);
    expect(await db.select().from(s.bufferPosts)).toHaveLength(0);
    // nothing consumed: fix the image and the same send goes through
    head = () => new Response(null, { status: 200, headers: { "content-type": "image/png" } });
    expect((await send({ channelId: "ch_test_li", attachImage: "yes" })).code).toBe("sent");
  });

  it("HEAD network error -> image_unreachable, no claim", async () => {
    await saveImage();
    head = () => { throw new TypeError("fetch failed"); };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await send({ channelId: "ch_test_li", attachImage: "yes" })).code).toBe("image_unreachable");
    spy.mockRestore();
    expect(bufferCalls()).toHaveLength(0);
    expect(await db.select().from(s.bufferPosts)).toHaveLength(0);
  });

  it("a text-only send body is unchanged from task 02", async () => {
    expect((await send({ channelId: "ch_test_x" })).code).toBe("sent");
    expect(String((bufferCalls()[0][1] as RequestInit).body)).toBe(JSON.stringify({
      query: (JSON.parse(String((bufferCalls()[0][1] as RequestInit).body)) as { query: string }).query,
      variables: { input: { channelId: "ch_test_x", text: "X text", schedulingType: "automatic", mode: "addToQueue", saveToDraft: true } },
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("task 02 idempotency still holds with an image: second send makes no request", async () => {
    await saveImage();
    expect((await send({ channelId: "ch_test_li", attachImage: "yes" })).code).toBe("sent");
    expect((await send({ channelId: "ch_test_li", attachImage: "yes" })).code).toBe("already_sent");
    expect(bufferCalls()).toHaveLength(1);
  });
});
