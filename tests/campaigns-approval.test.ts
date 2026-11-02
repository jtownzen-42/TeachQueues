// Brief, variants and "Approve exact version" against the real migrations (PGlite).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import {
  approveCampaignDraft, createCampaign, deleteCampaignTree, latestCampaignDraft, saveCampaignVariants, updateCampaign,
} from "@/lib/campaigns/service";
import { approvalHash } from "@/lib/campaigns/approval";
import { BRIEF, currentHash, IMG, makeDb, NOW, saveAndApprove, seedUser, templateTexts, type Seeded } from "./campaigns-fixtures";

const { client, db, sdb, ready } = makeDb();
let A: Seeded;
let B: Seeded;
const draftRow = async (id: string) => (await db.select().from(s.drafts).where(eq(s.drafts.id, id)))[0];
const approve = (userId: string, input: Record<string, unknown>) => approveCampaignDraft(sdb, userId, { checkAccurate: "yes", checkLink: "yes", ...input }, NOW);

beforeAll(async () => { await ready(); }, 30_000);
afterAll(async () => { await client.close(); });
beforeEach(async () => {
  await client.exec("truncate users cascade");
  A = await seedUser(db, "acctA");
  B = await seedUser(db, "acctB");
});

describe("brief", () => {
  it("creates for the user's own product only", async () => {
    const r = await createCampaign(sdb, A.userId, { ...BRIEF, productId: A.productId, startsOn: "2026-11-03" }, NOW);
    expect(r).toMatchObject({ ok: true, code: "campaign_created" });
    expect((await createCampaign(sdb, A.userId, { ...BRIEF, productId: B.productId }, NOW))).toMatchObject({ ok: false, code: "no_product" });
    expect((await createCampaign(sdb, A.userId, { ...BRIEF, name: "" , productId: A.productId }, NOW))).toMatchObject({ ok: false, code: "invalid" });
  });
  it("update is scoped to the user and leaves kind at organic", async () => {
    expect(await updateCampaign(sdb, B.userId, A.campaignId, { ...BRIEF, productId: B.productId }, NOW)).toMatchObject({ ok: false, code: "not_found" });
    expect(await updateCampaign(sdb, A.userId, A.campaignId, { ...BRIEF, name: "Renamed", productId: A.productId, kind: "ad" }, NOW)).toMatchObject({ ok: true });
    const [c] = await db.select().from(s.campaigns).where(eq(s.campaigns.id, A.campaignId));
    expect([c.name, c.kind]).toEqual(["Renamed", "organic"]);
  });
});

describe("variants", () => {
  it("first save inserts; unchanged save writes nothing", async () => {
    const { texts } = await templateTexts(sdb, A.userId, A.campaignId);
    const first = await saveCampaignVariants(sdb, A.userId, { campaignId: A.campaignId, ...texts }, NOW);
    expect(first).toMatchObject({ code: "draft_saved", wrote: "insert" });
    expect(await saveCampaignVariants(sdb, A.userId, { campaignId: A.campaignId, ...texts }, NOW)).toMatchObject({ code: "draft_saved", wrote: "none" });
    const d = await latestCampaignDraft(sdb, A.userId, A.campaignId);
    expect([d?.lessonId, d?.status]).toEqual([null, "draft"]);
  });
  it("invalid variants are refused with per-network notes, nothing stored", async () => {
    const { texts } = await templateTexts(sdb, A.userId, A.campaignId);
    const r = await saveCampaignVariants(sdb, A.userId, { campaignId: A.campaignId, ...texts, x: "no link here Prompt Pantry" }, NOW);
    expect(r.code).toBe("variants_invalid");
    if (r.code === "variants_invalid") expect(r.fields.x).toMatch(/tracking link/);
    expect(await latestCampaignDraft(sdb, A.userId, A.campaignId)).toBeNull();
  });
  it("another user's campaign -> not_found, no write", async () => {
    const { texts } = await templateTexts(sdb, A.userId, A.campaignId);
    expect((await saveCampaignVariants(sdb, B.userId, { campaignId: A.campaignId, ...texts }, NOW)).code).toBe("not_found");
    expect(await db.select().from(s.drafts).where(eq(s.drafts.campaignId, A.campaignId))).toHaveLength(0);
  });
});

describe("approval hash", () => {
  it("changes on a text edit, a brief change, a product change and a new image", async () => {
    const draftId = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    const h0 = await currentHash(sdb, db, A.userId, A.campaignId, draftId);

    const { texts } = await templateTexts(sdb, A.userId, A.campaignId);
    await db.update(s.drafts).set({ perChannelText: { ...texts, reddit: texts.reddit + " Edited." } }).where(eq(s.drafts.id, draftId));
    const hText = await currentHash(sdb, db, A.userId, A.campaignId, draftId);
    expect(hText).not.toBe(h0);
    await db.update(s.drafts).set({ perChannelText: texts }).where(eq(s.drafts.id, draftId));
    expect(await currentHash(sdb, db, A.userId, A.campaignId, draftId)).toBe(h0);

    await db.update(s.campaigns).set({ utmCampaign: "new-slug" }).where(eq(s.campaigns.id, A.campaignId));
    expect(await currentHash(sdb, db, A.userId, A.campaignId, draftId)).not.toBe(h0); // links changed
    await db.update(s.campaigns).set({ utmCampaign: null }).where(eq(s.campaigns.id, A.campaignId));

    await db.update(s.products).set({ url: "https://example.com/kit-v2" }).where(eq(s.products.id, A.productId));
    expect(await currentHash(sdb, db, A.userId, A.campaignId, draftId)).not.toBe(h0);
    await db.update(s.products).set({ url: "https://example.com/kit" }).where(eq(s.products.id, A.productId));
    expect(await currentHash(sdb, db, A.userId, A.campaignId, draftId)).toBe(h0);

    // a saved image for the current creative becomes part of the approved version
    const { creativeModelHash, campaignCreativeModel } = await import("@/lib/campaigns/creative");
    const [c] = await db.select().from(s.campaigns).where(eq(s.campaigns.id, A.campaignId));
    const [p] = await db.select().from(s.products).where(eq(s.products.id, A.productId));
    await db.update(s.drafts).set({ imageUrl: IMG, imageHash: creativeModelHash(campaignCreativeModel({ campaign: c, product: p })), imageSavedAt: NOW }).where(eq(s.drafts.id, draftId));
    expect(await currentHash(sdb, db, A.userId, A.campaignId, draftId)).not.toBe(h0);
    // a stale image (hash doesn't match the creative) counts as no image
    await db.update(s.drafts).set({ imageHash: "stale" }).where(eq(s.drafts.id, draftId));
    expect(await currentHash(sdb, db, A.userId, A.campaignId, draftId)).toBe(h0);
  });
  it("covers exactly texts, links and image hash", () => {
    const texts = { x: "a", facebook: "b", linkedin: "c", reddit: "d" };
    const links = { x: "1", facebook: "2", linkedin: "3", reddit: "4" };
    const h = approvalHash({ texts, links, imageHash: null });
    expect(approvalHash({ texts: { ...texts }, links: { ...links }, imageHash: null })).toBe(h);
    expect(approvalHash({ texts, links, imageHash: "img" })).not.toBe(h);
    expect(approvalHash({ texts: { ...texts, reddit: "e" }, links, imageHash: null })).not.toBe(h);
  });
});

describe("approveCampaignDraft", () => {
  async function saved() {
    const { texts } = await templateTexts(sdb, A.userId, A.campaignId);
    const r = await saveCampaignVariants(sdb, A.userId, { campaignId: A.campaignId, ...texts }, NOW);
    if (r.code !== "draft_saved") throw new Error();
    return { draftId: r.draftId, hash: await currentHash(sdb, db, A.userId, A.campaignId, r.draftId) };
  }

  it("requires both checks as the literal yes", async () => {
    const { draftId, hash } = await saved();
    for (const checks of [{ checkAccurate: "yes" }, { checkLink: "yes" }, { checkAccurate: "on", checkLink: "yes" }, {}]) {
      const r = await approveCampaignDraft(sdb, A.userId, { campaignId: A.campaignId, draftId, hash, ...checks }, NOW);
      expect(r.code).toBe("checks_required");
    }
    expect((await draftRow(draftId)).status).toBe("draft");
  });
  it("posted hash != server hash -> approval_changed, nothing stored", async () => {
    const { draftId } = await saved();
    expect((await approve(A.userId, { campaignId: A.campaignId, draftId, hash: "f".repeat(64) })).code).toBe("approval_changed");
    const d = await draftRow(draftId);
    expect([d.status, d.approvedHash, d.approvedAt]).toEqual(["draft", null, null]);
  });
  it("approves: status, hash and time; repeating is a no-op", async () => {
    const { draftId, hash } = await saved();
    expect((await approve(A.userId, { campaignId: A.campaignId, draftId, hash })).code).toBe("approved");
    const d = await draftRow(draftId);
    expect([d.status, d.approvedHash, d.approvedAt?.toISOString()]).toEqual(["approved", hash, NOW.toISOString()]);
    expect((await approve(A.userId, { campaignId: A.campaignId, draftId, hash })).code).toBe("approved");
  });
  it("other user / mismatched draft and campaign -> not_found", async () => {
    const { draftId, hash } = await saved();
    expect((await approve(B.userId, { campaignId: A.campaignId, draftId, hash })).code).toBe("not_found");
    expect((await approve(A.userId, { campaignId: B.campaignId, draftId, hash })).code).toBe("not_found");
    expect((await approve(A.userId, { campaignId: A.campaignId, draftId: A.lessonDraftId, hash })).code).toBe("not_found");
  });
  it("saving changed variants on an approved draft clears the approval and sets draft", async () => {
    const draftId = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    const { texts } = await templateTexts(sdb, A.userId, A.campaignId);
    const r = await saveCampaignVariants(sdb, A.userId, { campaignId: A.campaignId, ...texts, reddit: texts.reddit + " More context." }, NOW);
    expect(r).toMatchObject({ code: "draft_saved", draftId, wrote: "update" });
    const d = await draftRow(draftId);
    expect([d.status, d.approvedHash, d.approvedAt]).toEqual(["draft", null, null]);
  });
  it("saving changed variants on a queued draft inserts a new version (no image)", async () => {
    const draftId = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    await db.update(s.drafts).set({ status: "queued", imageUrl: IMG, imageHash: "h" }).where(eq(s.drafts.id, draftId));
    const { texts } = await templateTexts(sdb, A.userId, A.campaignId);
    const r = await saveCampaignVariants(sdb, A.userId, { campaignId: A.campaignId, ...texts, x: texts.x.replace("Plan", "Plan out") }, NOW);
    expect(r).toMatchObject({ code: "draft_saved", wrote: "new_version" });
    if (r.code === "draft_saved") expect(r.draftId).not.toBe(draftId);
    const old = await draftRow(draftId);
    expect([old.status, old.approvedHash !== null]).toEqual(["queued", true]); // history untouched
    const latest = await latestCampaignDraft(sdb, A.userId, A.campaignId);
    expect([latest?.status, latest?.imageUrl, latest?.approvedHash]).toEqual(["draft", null, null]);
  });
});

describe("deleteCampaignTree", () => {
  it("refuses with approved/queued drafts; otherwise deletes drafts and campaign, user-scoped", async () => {
    await saveAndApprove(sdb, db, A.userId, A.campaignId);
    expect(await deleteCampaignTree(sdb, A.userId, A.campaignId)).toBe("in_use");
    expect(await deleteCampaignTree(sdb, A.userId, B.campaignId)).toBe("not_found");
    const { texts } = await templateTexts(sdb, B.userId, B.campaignId);
    await saveCampaignVariants(sdb, B.userId, { campaignId: B.campaignId, ...texts }, NOW);
    expect(await deleteCampaignTree(sdb, B.userId, B.campaignId)).toBe("deleted");
    expect(await db.select().from(s.campaigns).where(eq(s.campaigns.id, B.campaignId))).toHaveLength(0);
    expect(await db.select().from(s.drafts).where(eq(s.drafts.campaignId, B.campaignId))).toHaveLength(0);
    expect(await db.select().from(s.drafts).where(eq(s.drafts.id, B.lessonDraftId))).toHaveLength(1);
  });
});
