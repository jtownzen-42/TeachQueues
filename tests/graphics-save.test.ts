// saveLessonImage against the real migrations (PGlite) with put/render mocked; no network, no Blob store.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";
import { IMAGE_SAVE_LIMIT_PER_DAY, IMAGE_WINDOW_MS, saveLessonImage, type SaveImageDeps } from "@/lib/graphics/save";
import { cardModelHash, lessonCardModel } from "@/lib/graphics/card";
import { deleteUserImages } from "@/lib/graphics/cleanup";

const client = new PGlite();
const db = drizzle(client, { schema: s });
const NOW = new Date("2026-11-02T15:00:00.000Z");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const blobUrl = (n: number) => `https://fake.public.blob.vercel-storage.com/teachqueue/lessons/x-${n}.png`;

let put: ReturnType<typeof vi.fn>;
let render: ReturnType<typeof vi.fn>;
let A: { userId: string; lessonId: string; draftId: string; productId: string };
let B: { userId: string; lessonId: string; draftId: string; productId: string };

const deps = (over: Partial<SaveImageDeps> = {}): SaveImageDeps => ({
  db: db as unknown as SendDb, put: put as unknown as SaveImageDeps["put"], render: render as unknown as SaveImageDeps["render"], now: () => NOW, ...over,
});
const draftRow = async (id: string) => (await db.select().from(s.drafts).where(eq(s.drafts.id, id)))[0];

async function seed(acct: string) {
  const [u] = await db.insert(s.users).values({ bufferAccountId: acct }).returning();
  const [p] = await db.insert(s.products).values({ userId: u.id, name: "Prompt Pantry", url: "https://example.com/p", brandColors: ["#2563eb"] }).returning();
  const [l] = await db.insert(s.lessons).values({ productId: p.id, term: "Few-shot", definition: "Examples first.", format: "glossary" }).returning();
  const [d] = await db.insert(s.drafts).values({ userId: u.id, lessonId: l.id, perChannelText: { x: "x", facebook: "f", linkedin: "l" } }).returning();
  return { userId: u.id, lessonId: l.id, draftId: d.id, productId: p.id };
}

beforeAll(async () => { await migrate(db, { migrationsFolder: "./drizzle" }); }, 30_000);
afterAll(async () => { await client.close(); });
beforeEach(async () => {
  await client.exec("truncate users cascade");
  A = await seed("acctA");
  B = await seed("acctB");
  let n = 0;
  put = vi.fn(async () => ({ url: blobUrl(++n) }));
  render = vi.fn(async () => PNG);
});

describe("saveLessonImage", () => {
  it("first save uploads once and stores URL, hash and time (status and text untouched)", async () => {
    const r = await saveLessonImage(deps(), A.userId, { lessonId: A.lessonId, draftId: A.draftId, imageUrl: "https://evil.example/x.png" });
    expect(r).toMatchObject({ code: "image_saved", url: blobUrl(1), uploaded: true });
    expect(put).toHaveBeenCalledTimes(1);
    const [pathname, body, opts] = put.mock.calls[0];
    expect(pathname).toMatch(new RegExp(`^teachqueue/lessons/${A.draftId}-[0-9a-f]{12}\\.png$`));
    expect(Buffer.isBuffer(body) && [...body]).toEqual([...PNG]);
    expect(opts).toEqual({ access: "public", addRandomSuffix: true, contentType: "image/png" });
    const d = await draftRow(A.draftId);
    const [l] = await db.select().from(s.lessons).where(eq(s.lessons.id, A.lessonId));
    const [p] = await db.select().from(s.products).where(eq(s.products.id, A.productId));
    expect(d.imageUrl).toBe(blobUrl(1));
    expect(d.imageHash).toBe(cardModelHash(lessonCardModel({ lesson: l, product: p })));
    expect(d.imageSavedAt?.toISOString()).toBe(NOW.toISOString());
    expect(d.status).toBe("draft");
    expect(d.perChannelText).toEqual({ x: "x", facebook: "f", linkedin: "l" });
  });

  it("re-saving an unchanged graphic uploads nothing", async () => {
    await saveLessonImage(deps(), A.userId, { lessonId: A.lessonId, draftId: A.draftId });
    const r = await saveLessonImage(deps(), A.userId, { lessonId: A.lessonId, draftId: A.draftId });
    expect(r).toMatchObject({ code: "image_saved", url: blobUrl(1), uploaded: false });
    expect(put).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("a changed lesson uploads a new image", async () => {
    await saveLessonImage(deps(), A.userId, { lessonId: A.lessonId, draftId: A.draftId });
    const before = await draftRow(A.draftId);
    await db.update(s.lessons).set({ term: "Zero-shot" }).where(eq(s.lessons.id, A.lessonId));
    const r = await saveLessonImage(deps(), A.userId, { lessonId: A.lessonId, draftId: A.draftId });
    expect(r).toMatchObject({ code: "image_saved", url: blobUrl(2), uploaded: true });
    expect(put).toHaveBeenCalledTimes(2);
    expect((await draftRow(A.draftId)).imageHash).not.toBe(before.imageHash);
  });

  it("a queued (already sent) draft can still get an image, staying queued", async () => {
    await db.update(s.drafts).set({ status: "queued" }).where(eq(s.drafts.id, A.draftId));
    expect((await saveLessonImage(deps(), A.userId, { lessonId: A.lessonId, draftId: A.draftId })).code).toBe("image_saved");
    expect((await draftRow(A.draftId)).status).toBe("queued");
  });

  it.each([
    ["another user's draft", () => ({ lessonId: A.lessonId, draftId: B.draftId })],
    ["another user's lesson", () => ({ lessonId: B.lessonId, draftId: A.draftId })],
    ["someone else's draft + lesson pair", () => ({ lessonId: B.lessonId, draftId: B.draftId })],
    ["non-uuid ids", () => ({ lessonId: "x", draftId: "y" })],
  ])("%s -> not_found, no upload", async (_n, input) => {
    expect((await saveLessonImage(deps(), A.userId, input())).code).toBe("not_found");
    expect(put).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it("draft from a different lesson of the same user -> not_found", async () => {
    const [l2] = await db.insert(s.lessons).values({ productId: A.productId, term: "Other", definition: "d" }).returning();
    expect((await saveLessonImage(deps(), A.userId, { lessonId: l2.id, draftId: A.draftId })).code).toBe("not_found");
    expect(put).not.toHaveBeenCalled();
  });

  it.each([
    ["http URL", "http://fake.public.blob.vercel-storage.com/x.png"],
    ["foreign host", "https://evil.example.com/x.png"],
    ["missing url", undefined],
  ])("put returning a bad URL (%s) -> image_failed, nothing stored", async (_n, url) => {
    put = vi.fn(async () => ({ url }));
    expect((await saveLessonImage(deps(), A.userId, { lessonId: A.lessonId, draftId: A.draftId })).code).toBe("image_failed");
    const d = await draftRow(A.draftId);
    expect([d.imageUrl, d.imageHash, d.imageSavedAt]).toEqual([null, null, null]);
  });

  it("put or render throwing -> image_failed, nothing stored, no secret in the log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    put = vi.fn(async () => { throw Object.assign(new Error("BLOB_READ_WRITE_TOKEN=vercel_blob_rw_FAKE"), { name: "BlobError" }); });
    expect((await saveLessonImage(deps(), A.userId, { lessonId: A.lessonId, draftId: A.draftId })).code).toBe("image_failed");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("vercel_blob_rw_FAKE");
    render = vi.fn(async () => { throw new Error("satori"); });
    expect((await saveLessonImage(deps(), A.userId, { lessonId: A.lessonId, draftId: A.draftId })).code).toBe("image_failed");
    expect((await draftRow(A.draftId)).imageUrl).toBeNull();
    spy.mockRestore();
  });

  it(`the ${IMAGE_SAVE_LIMIT_PER_DAY + 1}st save in 24 h -> image_limit, no upload`, async () => {
    for (let i = 0; i < IMAGE_SAVE_LIMIT_PER_DAY; i++) {
      await db.insert(s.drafts).values({ userId: A.userId, lessonId: A.lessonId, imageUrl: blobUrl(100 + i), imageHash: "old", imageSavedAt: new Date(NOW.getTime() - 3_600_000) });
    }
    expect((await saveLessonImage(deps(), A.userId, { lessonId: A.lessonId, draftId: A.draftId })).code).toBe("image_limit");
    expect(put).not.toHaveBeenCalled();
    // other users are unaffected; saves older than 24 h don't count
    expect((await saveLessonImage(deps(), B.userId, { lessonId: B.lessonId, draftId: B.draftId })).code).toBe("image_saved");
    await db.update(s.drafts).set({ imageSavedAt: new Date(NOW.getTime() - IMAGE_WINDOW_MS - 1000) }).where(eq(s.drafts.imageHash, "old"));
    expect((await saveLessonImage(deps(), A.userId, { lessonId: A.lessonId, draftId: A.draftId })).code).toBe("image_saved");
  });
  it("Blob storage not configured -> image_storage_off, no render, no upload, nothing stored", async () => {
    const r = await saveLessonImage(deps({ storageReady: false }), A.userId, { lessonId: A.lessonId, draftId: A.draftId });
    expect(r.code).toBe("image_storage_off");
    expect(render).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    const d = await draftRow(A.draftId);
    expect(d.imageUrl).toBeNull();
    expect(d.imageHash).toBeNull();
    expect(d.imageSavedAt).toBeNull();
  });
  it("storage-off still enforces ownership first (another user's draft -> not_found)", async () => {
    const r = await saveLessonImage(deps({ storageReady: false }), B.userId, { lessonId: A.lessonId, draftId: A.draftId });
    expect(r.code).toBe("not_found");
  });
  it("storage-off notice is whitelisted and friendly", async () => {
    const { deskNoticesFrom } = await import("@/lib/notices");
    const [n] = deskNoticesFrom({ n: "image_storage_off" });
    expect(n.kind).toBe("error");
    expect(n.text).toMatch(/^Image storage isn't set up yet/);
  });
});

describe("delete-my-data blob cleanup", () => {
  it("deletes only this user's valid Blob URLs and never throws", async () => {
    await db.update(s.drafts).set({ imageUrl: blobUrl(1) }).where(eq(s.drafts.id, A.draftId));
    await db.insert(s.drafts).values({ userId: A.userId, lessonId: A.lessonId, imageUrl: "https://evil.example/x.png" });
    await db.update(s.drafts).set({ imageUrl: blobUrl(9) }).where(eq(s.drafts.id, B.draftId));
    const del = vi.fn(async () => {});
    expect(await deleteUserImages(db as unknown as SendDb, A.userId, del)).toBe(1);
    expect(del).toHaveBeenCalledWith([blobUrl(1)]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await deleteUserImages(db as unknown as SendDb, A.userId, async () => { throw new Error("boom"); })).toBe(0);
    spy.mockRestore();
    const none = vi.fn(async () => {});
    expect(await deleteUserImages(db as unknown as SendDb, "00000000-0000-4000-8000-000000000000", none)).toBe(0);
    expect(none).not.toHaveBeenCalled();
  });
});
