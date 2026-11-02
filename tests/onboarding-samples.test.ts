// "Load sample products" / "Remove samples" against the real migrations (PGlite). No network.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";
import { loadSamples, removeSamples, SAMPLE_NOTE, SAMPLE_PRODUCTS } from "@/lib/onboarding/samples";
import { lessonInput, productInput } from "@/lib/lessons/validation";
import { deskNoticesFrom } from "@/lib/notices";

const client = new PGlite();
const db = drizzle(client, { schema: s });
const sdb = db as unknown as SendDb;
let fetchMock: ReturnType<typeof vi.fn>;
let A: string;
let B: string;

const productsOf = (userId: string) => db.select().from(s.products).where(eq(s.products.userId, userId)).orderBy(s.products.name);
const lessonsOf = (userId: string) => db.select({ l: s.lessons }).from(s.lessons)
  .innerJoin(s.products, eq(s.products.id, s.lessons.productId)).where(eq(s.products.userId, userId));
const sampleId = async (userId: string, key: string) =>
  (await db.select({ id: s.products.id }).from(s.products).where(and(eq(s.products.userId, userId), eq(s.products.sampleKey, key))))[0].id;

beforeAll(async () => { await migrate(db, { migrationsFolder: "./drizzle" }); }, 30_000);
afterAll(async () => { await client.close(); });
beforeEach(async () => {
  await client.exec("truncate users cascade");
  A = (await db.insert(s.users).values({ bufferAccountId: "acctA" }).returning())[0].id;
  B = (await db.insert(s.users).values({ bufferAccountId: "acctB" }).returning())[0].id;
  fetchMock = vi.fn(async () => { throw new Error("no network in onboarding code"); });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("sample content", () => {
  it("has exactly the two fixed samples", () => {
    expect(SAMPLE_PRODUCTS.map((p) => [p.key, p.name, p.url, p.brandColor, p.lesson.format])).toEqual([
      ["sourdough", "Sourdough Starter Guide (sample)", "https://example.com/samples/sourdough-starter-guide", "#b45309", "glossary"],
      ["budget", "Budget Spreadsheet Template (sample)", "https://example.com/samples/budget-spreadsheet-template", "#047857", "misconception"],
    ]);
    expect(SAMPLE_PRODUCTS[0].lesson).toEqual({
      format: "glossary", term: "Levain", example: null,
      definition: "A levain is a small portion of active sourdough starter mixed with fresh flour and water a few hours before baking, so the dough rises more predictably.",
    });
    expect(SAMPLE_PRODUCTS[1].lesson).toEqual({
      format: "misconception", term: "A budget means cutting out everything fun",
      definition: "A budget is a plan for where your money goes. You can include fun spending on purpose, so it is planned instead of a surprise.",
      example: "Set a fixed monthly amount for eating out, then spend it without guilt.",
    });
  });

  it("every sample passes productInput / lessonInput unchanged", () => {
    for (const p of SAMPLE_PRODUCTS) {
      expect(productInput.parse({ name: p.name, url: p.url, brandColor: p.brandColor })).toEqual({ name: p.name, url: p.url, brandColor: p.brandColor });
      expect(lessonInput.parse({ ...p.lesson, example: p.lesson.example ?? "" })).toEqual(p.lesson);
    }
  });

  it("no sample text names the owner or uses banned words", () => {
    const text = JSON.stringify(SAMPLE_PRODUCTS) + SAMPLE_NOTE;
    for (const w of ["alexx", "forge", "proof", "insurance", "stele"]) expect(text.toLowerCase()).not.toContain(w);
    for (const p of SAMPLE_PRODUCTS) expect(new URL(p.url).hostname).toBe("example.com");
  });

  it("all notice codes are whitelisted", () => {
    for (const c of ["samples_loaded", "samples_already_loaded", "samples_removed", "samples_partly_removed", "no_samples", "brand_saved", "brand_invalid"]) {
      expect(deskNoticesFrom({ n: c }), c).toHaveLength(1);
    }
    expect(deskNoticesFrom({ n: "<b>anything</b>" })).toEqual([]);
  });
});

describe("loadSamples", () => {
  it("inserts exactly 2 sample products + 2 lessons for that user", async () => {
    expect(await loadSamples(sdb, A)).toEqual({ code: "samples_loaded", inserted: 2 });
    const ps = await productsOf(A);
    expect(ps.map((p) => [p.name, p.url, p.brandColors, p.isSample, p.sampleKey])).toEqual([
      ["Budget Spreadsheet Template (sample)", "https://example.com/samples/budget-spreadsheet-template", ["#047857"], true, "budget"],
      ["Sourdough Starter Guide (sample)", "https://example.com/samples/sourdough-starter-guide", ["#b45309"], true, "sourdough"],
    ]);
    const ls = (await lessonsOf(A)).map((r) => r.l);
    expect(ls).toHaveLength(2);
    expect(ls.map((l) => l.term).sort()).toEqual(["A budget means cutting out everything fun", "Levain"]);
    for (const l of ls) expect(ps.map((p) => p.id)).toContain(l.productId);
    expect(await productsOf(B)).toEqual([]);
  });

  it("loading again inserts nothing", async () => {
    await loadSamples(sdb, A);
    expect(await loadSamples(sdb, A)).toEqual({ code: "samples_already_loaded", inserted: 0 });
    expect(await productsOf(A)).toHaveLength(2);
    expect(await lessonsOf(A)).toHaveLength(2);
  });

  it("two concurrent loads never duplicate", async () => {
    const rs = await Promise.all([loadSamples(sdb, A), loadSamples(sdb, A), loadSamples(sdb, A)]);
    expect(rs.reduce((n, r) => n + r.inserted, 0)).toBe(2);
    expect(await productsOf(A)).toHaveLength(2);
    expect(await lessonsOf(A)).toHaveLength(2);
  });

  it("re-adds only the missing sample after one was removed by hand", async () => {
    await loadSamples(sdb, A);
    await db.delete(s.products).where(eq(s.products.id, await sampleId(A, "budget")));
    expect(await loadSamples(sdb, A)).toEqual({ code: "samples_loaded", inserted: 1 });
    expect(await productsOf(A)).toHaveLength(2);
    expect(await lessonsOf(A)).toHaveLength(2);
  });

  it("another user's load doesn't affect this user", async () => {
    await loadSamples(sdb, A);
    expect(await loadSamples(sdb, B)).toEqual({ code: "samples_loaded", inserted: 2 });
    expect(await productsOf(A)).toHaveLength(2);
    expect(await productsOf(B)).toHaveLength(2);
    expect(await lessonsOf(A)).toHaveLength(2);
  });

  it("normal products (sample_key null) are unaffected by the unique index", async () => {
    await db.insert(s.products).values([
      { userId: A, name: "Own 1", url: "https://example.com/1" },
      { userId: A, name: "Own 2", url: "https://example.com/2" },
    ]);
    await loadSamples(sdb, A);
    const ps = await productsOf(A);
    expect(ps).toHaveLength(4);
    expect(ps.filter((p) => !p.isSample).map((p) => p.sampleKey)).toEqual([null, null]);
  });
});

describe("removeSamples", () => {
  it("none -> no_samples", async () => {
    await db.insert(s.products).values({ userId: A, name: "Own", url: "https://example.com/own" });
    expect(await removeSamples(sdb, A)).toEqual({ code: "no_samples", removed: 0, kept: 0 });
    expect(await productsOf(A)).toHaveLength(1);
  });

  it("deletes only samples (lessons and unsent drafts too); own products and other users stay", async () => {
    const [own] = await db.insert(s.products).values({ userId: A, name: "Own", url: "https://example.com/own" }).returning();
    await db.insert(s.lessons).values({ productId: own.id, term: "Own term", definition: "Own definition." });
    await loadSamples(sdb, A);
    await loadSamples(sdb, B);
    const [l] = (await lessonsOf(A)).map((r) => r.l).filter((x) => x.productId !== own.id);
    await db.insert(s.drafts).values({ userId: A, lessonId: l.id, perChannelText: { x: "x", facebook: "f", linkedin: "l" } });

    expect(await removeSamples(sdb, A)).toEqual({ code: "samples_removed", removed: 2, kept: 0 });
    expect((await productsOf(A)).map((p) => p.name)).toEqual(["Own"]);
    expect((await lessonsOf(A)).map((r) => r.l.term)).toEqual(["Own term"]);
    expect(await db.select().from(s.drafts).where(eq(s.drafts.userId, A))).toEqual([]);
    expect(await productsOf(B)).toHaveLength(2);
    // Removing again: nothing left.
    expect(await removeSamples(sdb, A)).toEqual({ code: "no_samples", removed: 0, kept: 0 });
    // And they can be loaded again.
    expect((await loadSamples(sdb, A)).inserted).toBe(2);
  });

  it("a sample used by a campaign is kept -> samples_partly_removed", async () => {
    await loadSamples(sdb, A);
    const budget = await sampleId(A, "budget");
    await db.insert(s.campaigns).values({ userId: A, productId: budget, name: "C" });
    expect(await removeSamples(sdb, A)).toEqual({ code: "samples_partly_removed", removed: 1, kept: 1 });
    expect((await productsOf(A)).map((p) => p.sampleKey)).toEqual(["budget"]);
  });

  it("a sample whose lesson has a queued draft is kept (history is never lost)", async () => {
    await loadSamples(sdb, A);
    const sour = await sampleId(A, "sourdough");
    const [l] = await db.select().from(s.lessons).where(eq(s.lessons.productId, sour));
    const [d] = await db.insert(s.drafts).values({ userId: A, lessonId: l.id, status: "queued" }).returning();
    await db.insert(s.bufferPosts).values({ draftId: d.id, channelId: "ch_test", service: "linkedin", bufferPostId: "post_FAKE" });
    expect(await removeSamples(sdb, A)).toEqual({ code: "samples_partly_removed", removed: 1, kept: 1 });
    expect((await productsOf(A)).map((p) => p.sampleKey)).toEqual(["sourdough"]);
    expect(await db.select().from(s.drafts).where(eq(s.drafts.id, d.id))).toHaveLength(1);
    expect(await db.select().from(s.bufferPosts)).toHaveLength(1);
  });

  it("never touches another user's samples", async () => {
    await loadSamples(sdb, B);
    expect(await removeSamples(sdb, A)).toEqual({ code: "no_samples", removed: 0, kept: 0 });
    expect(await productsOf(B)).toHaveLength(2);
  });
});

describe("review hardening: Remove samples never deletes the user's own edits", () => {
  it("a sample whose product link was changed to the user's own is kept", async () => {
    await loadSamples(sdb, A);
    await db.update(s.products).set({ url: "https://example.com/my-real-guide" }).where(eq(s.products.id, await sampleId(A, "sourdough")));
    expect(await removeSamples(sdb, A)).toEqual({ code: "samples_partly_removed", removed: 1, kept: 1 });
    expect((await productsOf(A)).map((p) => p.url)).toEqual(["https://example.com/my-real-guide"]);
  });
  it("a sample with a renamed product or changed colour is kept", async () => {
    await loadSamples(sdb, A);
    await db.update(s.products).set({ name: "My Budget Kit" }).where(eq(s.products.id, await sampleId(A, "budget")));
    await db.update(s.products).set({ brandColors: ["#123456"] }).where(eq(s.products.id, await sampleId(A, "sourdough")));
    expect(await removeSamples(sdb, A)).toEqual({ code: "samples_partly_removed", removed: 0, kept: 2 });
    expect(await productsOf(A)).toHaveLength(2);
  });
  it("a sample whose lesson was edited, or that got an extra lesson, is kept with all its lessons", async () => {
    await loadSamples(sdb, A);
    const sour = await sampleId(A, "sourdough");
    const budget = await sampleId(A, "budget");
    await db.update(s.lessons).set({ definition: "My own wording." }).where(eq(s.lessons.productId, sour));
    await db.insert(s.lessons).values({ productId: budget, term: "My lesson", definition: "Mine." });
    expect(await removeSamples(sdb, A)).toEqual({ code: "samples_partly_removed", removed: 0, kept: 2 });
    expect((await lessonsOf(A)).map((r) => r.l.term).sort()).toEqual(["A budget means cutting out everything fun", "Levain", "My lesson"]);
  });
  it("an untouched sample next to an edited one is still removed", async () => {
    await loadSamples(sdb, A);
    await db.update(s.lessons).set({ example: "Mine." }).where(eq(s.lessons.productId, await sampleId(A, "sourdough")));
    expect(await removeSamples(sdb, A)).toEqual({ code: "samples_partly_removed", removed: 1, kept: 1 });
    expect((await productsOf(A)).map((p) => p.sampleKey)).toEqual(["sourdough"]);
  });
  it("a sample whose lesson was deleted by hand is still removable", async () => {
    await loadSamples(sdb, A);
    await db.delete(s.lessons).where(eq(s.lessons.productId, await sampleId(A, "budget")));
    expect(await removeSamples(sdb, A)).toEqual({ code: "samples_removed", removed: 2, kept: 0 });
  });
});
