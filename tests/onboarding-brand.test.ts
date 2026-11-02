// Per-user brand name on graphics: validation, models, the saving service, and that every place
// that builds a card/creative hash uses the same user's brand_name (PGlite). No network.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { brandInput } from "@/lib/onboarding/validation";
import { saveBrandName } from "@/lib/onboarding/brand";
import { brandNameFor } from "@/lib/graphics/brand";
import { CARD_DESIGN_VERSION, cardModelHash, lessonCardModel, MARK_MAX, stableJson } from "@/lib/graphics/card";
import { CREATIVE_DESIGN_VERSION, campaignCreativeModel, creativeModelHash } from "@/lib/campaigns/creative";
import { graphicGuard } from "@/lib/graphics/guard";
import { creativeGuard } from "@/lib/campaigns/guard";
import { saveLessonImage } from "@/lib/graphics/save";
import { saveCampaignImage } from "@/lib/campaigns/save";
import { approvalState, isApprovalCurrent } from "@/lib/campaigns/approval";
import { loadOwnedCampaign, saveCampaignVariants, approveCampaignDraft } from "@/lib/campaigns/service";
import { resolveImageUrl, sendDraftToBuffer, type SendDb, type SendDeps } from "@/lib/buffer/send";
import { makeDb, NOW, seedUser, templateTexts, type Seeded } from "./campaigns-fixtures";

/** Same query as getLessonWithProduct (src/lib/lessons/data.ts), with the test db. */
async function getLessonWithProductWith(d: SendDb, userId: string, lessonId: string) {
  const [row] = await d.select({ lesson: s.lessons, product: s.products }).from(s.lessons)
    .innerJoin(s.products, eq(s.lessons.productId, s.products.id))
    .where(and(eq(s.lessons.id, lessonId), eq(s.products.userId, userId)));
  return row ?? null;
}

// ---- validation & models (pure) -------------------------------------------------------------
describe("brandInput", () => {
  const parse = (v: unknown) => brandInput.safeParse({ brandName: v });
  it("trims, collapses whitespace, empty -> null", () => {
    expect(parse("  Studio   Example\t Co \n").data).toEqual({ brandName: "Studio Example Co" });
    expect(parse("").data).toEqual({ brandName: null });
    expect(parse("   \n ").data).toEqual({ brandName: null });
    expect(parse(undefined).data).toEqual({ brandName: null });
    expect(brandInput.safeParse({}).data).toEqual({ brandName: null });
  });
  it("max 40 code points (not UTF-16 units)", () => {
    expect(MARK_MAX).toBe(40);
    expect(parse("a".repeat(40)).success).toBe(true);
    expect(parse("a".repeat(41)).success).toBe(false);
    expect(parse("😀".repeat(40)).success).toBe(true); // 80 UTF-16 units
    expect(parse("😀".repeat(41)).success).toBe(false);
    expect(parse(` ${"b".repeat(40)}   `).success).toBe(true); // counted after trimming
  });
  it("rejects control and invisible characters", () => {
    for (const bad of ["a\u0000b", "a\u0007b", "a\u007fb", "a\u0085b", "a\u200bb", "a\u202eb", "a\u2066b", "\ufeffab", "a\u2028b"]) {
      expect(parse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(parse(42).success).toBe(false);
    expect(parse("Café & Co. — Ünïcode").data).toEqual({ brandName: "Café & Co. — Ünïcode" });
  });
});

const lesson = { term: "Levain", definition: "A levain is a small portion of active sourdough starter mixed with fresh flour and water.", example: null, format: "glossary" as const };
const product = { name: "Studio Example Kit", brandColors: ["#b45309"] };
const campaign = { keyMessage: "Bake better bread this week.", angle: "A short guide with three recipes.", cta: "Get the guide" };

describe("models", () => {
  it("draw no mark for null / empty / whitespace / missing", () => {
    for (const b of [null, undefined, "", "   "]) {
      expect(lessonCardModel({ lesson, product, brandName: b }).mark).toBeNull();
      expect(campaignCreativeModel({ campaign, product, brandName: b }).mark).toBeNull();
    }
    expect(lessonCardModel({ lesson, product }).mark).toBeNull();
    expect(campaignCreativeModel({ campaign, product }).mark).toBeNull();
  });
  it("draw the brand name (truncated at word boundaries to 40)", () => {
    expect(lessonCardModel({ lesson, product, brandName: "Studio Example" }).mark).toBe("Studio Example");
    expect(campaignCreativeModel({ campaign, product, brandName: "Studio Example" }).mark).toBe("Studio Example");
    const long = lessonCardModel({ lesson, product, brandName: "word ".repeat(20) }).mark!;
    expect([...long].length).toBeLessThanOrEqual(40);
  });
  it("different brands -> different hashes; no brand differs from a brand", () => {
    const h = (b: string | null) => cardModelHash(lessonCardModel({ lesson, product, brandName: b }));
    const c = (b: string | null) => creativeModelHash(campaignCreativeModel({ campaign, product, brandName: b }));
    expect(new Set([h(null), h("Studio Example"), h("Other Studio")]).size).toBe(3);
    expect(new Set([c(null), c("Studio Example"), c("Other Studio")]).size).toBe(3);
  });

  it('"Alexx Forge" keeps byte-identical hashes with the pre-change code (design versions unchanged)', () => {
    // Hex values computed with the previous code (mark: "Alexx Forge" hardcoded) for these fixtures.
    const OLD_CARD = "f7bd5af19af1399a52b80ef7ed17c90bff564b0517edac397d021eb35b853428";
    const OLD_CREATIVE = "d2ad7f16f4a42a3f8a812f6d41ca6f2ce9e5882aef678694ffca23663fe8b9fd";
    const card = lessonCardModel({ lesson, product, brandName: "Alexx Forge" });
    const creative = campaignCreativeModel({ campaign, product, brandName: "Alexx Forge" });
    expect(cardModelHash(card)).toBe(OLD_CARD);
    expect(creativeModelHash(creative)).toBe(OLD_CREATIVE);
    // Same thing via stableJson directly, so the construction is visible.
    expect(createHash("sha256").update(stableJson({ v: CARD_DESIGN_VERSION, model: card })).digest("hex")).toBe(OLD_CARD);
    expect(createHash("sha256").update(stableJson({ v: CREATIVE_DESIGN_VERSION, model: creative })).digest("hex")).toBe(OLD_CREATIVE);
  });
});

// ---- PGlite: saving and consistency -----------------------------------------------------------
const { client, db, sdb, ready } = makeDb();
const IMG_URL = (n: number) => `https://fake.public.blob.vercel-storage.com/teachqueue/x-${n}.png`;
const CHANNELS: s.BufferChannel[] = [{ id: "ch_test_li", name: "LI", service: "linkedin" }];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
let A: Seeded;
let B: Seeded;
let n = 0;
let fetchMock: ReturnType<typeof vi.fn>;

const put = vi.fn(async () => ({ url: IMG_URL(++n) }));
const render = vi.fn(async () => PNG);
const userRow = async (id: string) => (await db.select().from(s.users).where(eq(s.users.id, id)))[0];
const draftRow = async (id: string) => (await db.select().from(s.drafts).where(eq(s.drafts.id, id)))[0];

/** What src/app/lessons/[id]/page.tsx does: lesson+product for the user, brand from users. */
async function pageLessonHash(userId: string, lessonId: string) {
  const row = (await getLessonWithProductWith(sdb, userId, lessonId))!;
  const u = await userRow(userId);
  return cardModelHash(lessonCardModel({ lesson: row.lesson, product: row.product, brandName: u.brandName }));
}
/** What src/app/campaigns/[id]/page.tsx does. */
async function pageCampaignState(userId: string, campaignId: string, draftId: string) {
  const owned = (await loadOwnedCampaign(sdb, userId, campaignId))!;
  const u = await userRow(userId);
  return { creativeHash: creativeModelHash(campaignCreativeModel({ campaign: owned.campaign, product: owned.product!, brandName: u.brandName })),
    state: approvalState(await draftRow(draftId), owned.campaign, owned.product!, u.brandName) };
}
const guardLesson = (userId: string, lessonId: string) => graphicGuard({
  getUserId: async () => userId, loadLesson: (uid, lid) => getLessonWithProductWith(sdb, uid, lid), getBrandName: (uid) => brandNameFor(sdb, uid),
}, lessonId);
const guardCreative = (userId: string, campaignId: string) => creativeGuard({
  getUserId: async () => userId, loadCampaign: (uid, cid) => loadOwnedCampaign(sdb, uid, cid), getBrandName: (uid) => brandNameFor(sdb, uid),
}, campaignId, "square");

beforeAll(async () => { await ready(); }, 30_000);
afterAll(async () => { await client.close(); });
beforeEach(async () => {
  await client.exec("truncate users cascade");
  A = await seedUser(db, "acctA", CHANNELS);
  B = await seedUser(db, "acctB", CHANNELS);
  put.mockClear(); render.mockClear();
  fetchMock = vi.fn(async () => { throw new Error("no network"); });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("saveBrandName", () => {
  it("updates only the session user's row; empty clears it", async () => {
    await saveBrandName(sdb, B.userId, { brandName: "Other Studio" });
    expect(await saveBrandName(sdb, A.userId, { brandName: "  Studio   Example " })).toEqual({ code: "brand_saved", brandName: "Studio Example" });
    expect((await userRow(A.userId)).brandName).toBe("Studio Example");
    expect((await userRow(B.userId)).brandName).toBe("Other Studio");
    expect(await brandNameFor(sdb, A.userId)).toBe("Studio Example");
    expect(await saveBrandName(sdb, A.userId, { brandName: "" })).toEqual({ code: "brand_saved", brandName: null });
    expect((await userRow(A.userId)).brandName).toBeNull();
    expect((await userRow(B.userId)).brandName).toBe("Other Studio");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("invalid input changes nothing", async () => {
    await saveBrandName(sdb, A.userId, { brandName: "Studio Example" });
    const r = await saveBrandName(sdb, A.userId, { brandName: "x".repeat(41) });
    expect(r.code).toBe("brand_invalid");
    expect((await saveBrandName(sdb, A.userId, { brandName: "bad\u0000name" })).code).toBe("brand_invalid");
    expect((await userRow(A.userId)).brandName).toBe("Studio Example");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("unknown fields are ignored (can't target another user)", async () => {
    await saveBrandName(sdb, A.userId, { brandName: "Mine", userId: B.userId, id: B.userId });
    expect((await userRow(A.userId)).brandName).toBe("Mine");
    expect((await userRow(B.userId)).brandName).toBeNull();
  });
  it("new users have no brand name (no mark drawn)", async () => {
    expect(await brandNameFor(sdb, A.userId)).toBeNull();
    const g = await guardLesson(A.userId, A.lessonId);
    expect(g.status === 200 && g.model.mark).toBeNull();
  });
});

describe("lesson graphic: page, guard, save service and send agree on the hash", () => {
  it('brand "Studio Example": all agree; changing the brand makes the saved image stale', async () => {
    await saveBrandName(sdb, A.userId, { brandName: "Studio Example" });
    await saveBrandName(sdb, B.userId, { brandName: "Other Studio" });

    const page = await pageLessonHash(A.userId, A.lessonId);
    const g = await guardLesson(A.userId, A.lessonId);
    if (g.status !== 200) throw new Error("guard");
    expect(g.model.mark).toBe("Studio Example");
    expect(g.hash).toBe(page);

    const saved = await saveLessonImage({ db: sdb, put, render, now: () => NOW }, A.userId, { lessonId: A.lessonId, draftId: A.lessonDraftId });
    expect(saved).toMatchObject({ code: "image_saved", uploaded: true });
    expect((render.mock.calls[0] as unknown[])[0]).toMatchObject({ mark: "Studio Example" });
    const d = await draftRow(A.lessonDraftId);
    expect(d.imageHash).toBe(page);
    expect(await resolveImageUrl(sdb, A.userId, d, "Studio Example")).toBe(d.imageUrl);
    // The other user's brand never leaks in: the same rows with B's brand give another hash.
    expect(await resolveImageUrl(sdb, A.userId, d, "Other Studio")).toBeNull();

    await saveBrandName(sdb, A.userId, { brandName: "Studio Example Two" });
    expect(await pageLessonHash(A.userId, A.lessonId)).not.toBe(page);
    const g2 = await guardLesson(A.userId, A.lessonId);
    expect(g2.status === 200 && g2.hash).not.toBe(page);
    expect(await resolveImageUrl(sdb, A.userId, await draftRow(A.lessonDraftId), await brandNameFor(sdb, A.userId))).toBeNull();
    // Saving again uploads a new image with the new brand.
    const again = await saveLessonImage({ db: sdb, put, render, now: () => NOW }, A.userId, { lessonId: A.lessonId, draftId: A.lessonDraftId });
    expect(again).toMatchObject({ code: "image_saved", uploaded: true });
    expect((await draftRow(A.lessonDraftId)).imageHash).toBe(await pageLessonHash(A.userId, A.lessonId));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("send attaches the saved image only while the brand is unchanged", async () => {
    await saveBrandName(sdb, A.userId, { brandName: "Studio Example" });
    await saveLessonImage({ db: sdb, put, render, now: () => NOW }, A.userId, { lessonId: A.lessonId, draftId: A.lessonDraftId });
    let post = 0;
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "HEAD"
      ? new Response(null, { status: 200, headers: { "content-type": "image/png" } })
      : new Response(JSON.stringify({ data: { createPost: { __typename: "PostActionSuccess", post: { id: `post_FAKE_${++post}`, status: "draft", dueAt: null, externalLink: null } } } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const deps: SendDeps = { db: sdb, getToken: async () => "tok_FAKE", now: () => NOW, envTestMode: undefined };
    const bufferInputs = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("https://api.buffer.com"))
      .map((c) => JSON.parse(String((c[1] as RequestInit).body)).variables.input);

    expect((await sendDraftToBuffer(deps, A.userId, { draftId: A.lessonDraftId, channelId: "ch_test_li", mode: "queue", attachImage: "yes" })).code).toBe("sent");
    expect(bufferInputs()[0].assets).toBeTruthy();
    expect(bufferInputs()[0].saveToDraft).toBe(true);

    await db.delete(s.bufferPosts);
    await saveBrandName(sdb, A.userId, { brandName: "Changed" });
    expect((await sendDraftToBuffer(deps, A.userId, { draftId: A.lessonDraftId, channelId: "ch_test_li", mode: "queue", attachImage: "yes" })).code).toBe("sent");
    expect(bufferInputs()[1].assets).toBeUndefined();
  });
});

describe("campaign creative: page, guard, save service, approval and send agree", () => {
  async function savedApprovedWithImage(userId: string, campaignId: string) {
    const { texts } = await templateTexts(sdb, userId, campaignId);
    const r = await saveCampaignVariants(sdb, userId, { campaignId, ...texts }, NOW);
    if (r.code !== "draft_saved") throw new Error(r.code);
    const img = await saveCampaignImage({ db: sdb, put, render, now: () => NOW }, userId, { campaignId, draftId: r.draftId });
    expect(img).toMatchObject({ code: "image_saved" });
    const { state } = await pageCampaignState(userId, campaignId, r.draftId);
    const ap = await approveCampaignDraft(sdb, userId, { campaignId, draftId: r.draftId, hash: state.hash, checkAccurate: "yes", checkLink: "yes" }, NOW);
    expect(ap.code).toBe("approved");
    return r.draftId;
  }

  it('brand "Studio Example": hashes agree, approval current; a brand change makes the approval stale', async () => {
    await saveBrandName(sdb, A.userId, { brandName: "Studio Example" });
    const draftId = await savedApprovedWithImage(A.userId, A.campaignId);

    const { creativeHash, state } = await pageCampaignState(A.userId, A.campaignId, draftId);
    const g = await guardCreative(A.userId, A.campaignId);
    if (g.status !== 200) throw new Error("guard");
    expect(g.model.mark).toBe("Studio Example");
    expect(g.hash).toBe(creativeHash);
    const d = await draftRow(draftId);
    expect(d.imageHash).toBe(creativeHash);
    expect(state.imageUrl).toBe(d.imageUrl);
    expect(isApprovalCurrent(d, state)).toBe(true);
    expect(await resolveImageUrl(sdb, A.userId, d, "Studio Example")).toBe(d.imageUrl);

    await saveBrandName(sdb, A.userId, { brandName: "Studio Example Two" });
    const after = await pageCampaignState(A.userId, A.campaignId, draftId);
    expect(after.creativeHash).not.toBe(creativeHash);
    expect(after.state.imageUrl).toBeNull();
    expect(isApprovalCurrent(await draftRow(draftId), after.state)).toBe(false);
    expect(await resolveImageUrl(sdb, A.userId, d, "Studio Example Two")).toBeNull();

    // The send path uses the same brand: the stale approval is refused before any request.
    const deps: SendDeps = { db: sdb, getToken: async () => "tok_FAKE", now: () => NOW, envTestMode: undefined };
    expect((await sendDraftToBuffer(deps, A.userId, { draftId, channelId: "ch_test_li", mode: "queue" })).code).toBe("not_approved");
    expect(fetchMock).not.toHaveBeenCalled();

    // Changing it back restores the same hashes (nothing else changed).
    await saveBrandName(sdb, A.userId, { brandName: "Studio Example" });
    expect(isApprovalCurrent(await draftRow(draftId), (await pageCampaignState(A.userId, A.campaignId, draftId)).state)).toBe(true);
    // ...and the send path accepts it again, with the approved image attached.
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "HEAD"
      ? new Response(null, { status: 200, headers: { "content-type": "image/png" } })
      : new Response(JSON.stringify({ data: { createPost: { __typename: "PostActionSuccess", post: { id: "post_FAKE_1", status: "draft", dueAt: null, externalLink: null } } } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await sendDraftToBuffer(deps, A.userId, { draftId, channelId: "ch_test_li", mode: "queue", attachImage: "yes" })).code).toBe("sent");
    const input = JSON.parse(String((fetchMock.mock.calls.find((c) => String(c[0]).startsWith("https://api.buffer.com"))![1] as RequestInit).body)).variables.input;
    expect(JSON.stringify(input.assets)).toContain(d.imageUrl!);
  });

  it('a user whose brand is "Alexx Forge" keeps hashes equal to the old hardcoded mark', async () => {
    await saveBrandName(sdb, A.userId, { brandName: "Alexx Forge" });
    const owned = (await loadOwnedCampaign(sdb, A.userId, A.campaignId))!;
    const oldCreative = campaignCreativeModel({ campaign: owned.campaign, product: owned.product! });
    const withOldMark = createHash("sha256").update(stableJson({ v: CREATIVE_DESIGN_VERSION, model: { ...oldCreative, mark: "Alexx Forge" } })).digest("hex");
    const g = await guardCreative(A.userId, A.campaignId);
    expect(g.status === 200 && g.hash).toBe(withOldMark);

    const row = (await getLessonWithProductWith(sdb, A.userId, A.lessonId))!;
    const oldCard = lessonCardModel(row);
    const cardWithOldMark = createHash("sha256").update(stableJson({ v: CARD_DESIGN_VERSION, model: { ...oldCard, mark: "Alexx Forge" } })).digest("hex");
    const gl = await guardLesson(A.userId, A.lessonId);
    expect(gl.status === 200 && gl.hash).toBe(cardWithOldMark);
  });
});
