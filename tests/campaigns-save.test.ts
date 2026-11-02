// "Save square image" for campaigns (PGlite, put/render mocked) and delete-my-data coverage.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { saveCampaignImage, type SaveCampaignImageDeps } from "@/lib/campaigns/save";
import { saveLessonImage, type SaveImageDeps, IMAGE_SAVE_LIMIT_PER_DAY } from "@/lib/graphics/save";
import { saveCampaignVariants } from "@/lib/campaigns/service";
import { campaignCreativeModel, creativeModelHash } from "@/lib/campaigns/creative";
import { makeDb, NOW, saveAndApprove, seedUser, templateTexts, type Seeded } from "./campaigns-fixtures";

const { client, db, sdb, ready } = makeDb();
let A: Seeded;
let B: Seeded;
let put: ReturnType<typeof vi.fn>;
let render: ReturnType<typeof vi.fn>;
const url = (i: number) => `https://fake.public.blob.vercel-storage.com/teachqueue/campaigns/x-${i}.png`;
const deps = (over: Partial<SaveCampaignImageDeps> = {}): SaveCampaignImageDeps => ({
  db: sdb, put: put as unknown as SaveCampaignImageDeps["put"], render: render as unknown as SaveCampaignImageDeps["render"], now: () => NOW, ...over,
});

async function savedDraft(seed: Seeded) {
  const { texts } = await templateTexts(sdb, seed.userId, seed.campaignId);
  const r = await saveCampaignVariants(sdb, seed.userId, { campaignId: seed.campaignId, ...texts }, NOW);
  if (r.code !== "draft_saved") throw new Error();
  return r.draftId;
}

beforeAll(async () => { await ready(); }, 30_000);
afterAll(async () => { await client.close(); });
beforeEach(async () => {
  await client.exec("truncate users cascade");
  A = await seedUser(db, "acctA");
  B = await seedUser(db, "acctB");
  let i = 0;
  put = vi.fn(async () => ({ url: url(++i) }));
  render = vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
});

describe("saveCampaignImage", () => {
  it("first save uploads the square PNG and stores url/hash/time; status and texts untouched", async () => {
    const draftId = await savedDraft(A);
    const r = await saveCampaignImage(deps(), A.userId, { campaignId: A.campaignId, draftId, imageUrl: "https://evil.example/x.png" });
    expect(r).toMatchObject({ code: "image_saved", url: url(1), uploaded: true });
    const [pathname, , opts] = put.mock.calls[0];
    expect(pathname).toMatch(new RegExp(`^teachqueue/campaigns/${draftId}-[0-9a-f]{12}\\.png$`));
    expect(opts).toEqual({ access: "public", addRandomSuffix: true, contentType: "image/png" });
    const [d] = await db.select().from(s.drafts).where(eq(s.drafts.id, draftId));
    const [c] = await db.select().from(s.campaigns).where(eq(s.campaigns.id, A.campaignId));
    const [p] = await db.select().from(s.products).where(eq(s.products.id, A.productId));
    expect(d.imageHash).toBe(creativeModelHash(campaignCreativeModel({ campaign: c, product: p })));
    expect([d.imageUrl, d.imageSavedAt?.toISOString(), d.status]).toEqual([url(1), NOW.toISOString(), "draft"]);
  });
  it("idempotent by creative hash; a brief change uploads again", async () => {
    const draftId = await savedDraft(A);
    await saveCampaignImage(deps(), A.userId, { campaignId: A.campaignId, draftId });
    expect(await saveCampaignImage(deps(), A.userId, { campaignId: A.campaignId, draftId })).toMatchObject({ code: "image_saved", uploaded: false });
    expect(put).toHaveBeenCalledTimes(1);
    await db.update(s.campaigns).set({ keyMessage: "New headline." }).where(eq(s.campaigns.id, A.campaignId));
    expect(await saveCampaignImage(deps(), A.userId, { campaignId: A.campaignId, draftId })).toMatchObject({ code: "image_saved", uploaded: true });
    expect(put).toHaveBeenCalledTimes(2);
  });
  it("other user's campaign or draft -> not_found, no put; lesson draft can't be used", async () => {
    const draftA = await savedDraft(A);
    const draftB = await savedDraft(B);
    for (const input of [
      { campaignId: A.campaignId, draftId: draftA, as: B.userId },
      { campaignId: B.campaignId, draftId: draftA, as: A.userId },
      { campaignId: A.campaignId, draftId: draftB, as: A.userId },
      { campaignId: A.campaignId, draftId: A.lessonDraftId, as: A.userId },
    ]) {
      expect((await saveCampaignImage(deps(), input.as, { campaignId: input.campaignId, draftId: input.draftId })).code).toBe("not_found");
    }
    expect(put).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
  it("bad URL from put -> image_failed, nothing stored; storage off -> image_storage_off", async () => {
    const draftId = await savedDraft(A);
    expect((await saveCampaignImage(deps({ put: vi.fn(async () => ({ url: "https://evil.example/x.png" })) as unknown as SaveCampaignImageDeps["put"] }), A.userId, { campaignId: A.campaignId, draftId })).code).toBe("image_failed");
    expect((await db.select().from(s.drafts).where(eq(s.drafts.id, draftId)))[0].imageUrl).toBeNull();
    expect((await saveCampaignImage(deps({ storageReady: false }), A.userId, { campaignId: A.campaignId, draftId })).code).toBe("image_storage_off");
    expect(put).not.toHaveBeenCalled();
  });
  it(`shares the ${IMAGE_SAVE_LIMIT_PER_DAY}/day limit with lesson images`, async () => {
    // 29 lesson image saves today + 1 campaign save = 30; the next of either kind is refused.
    for (let i = 0; i < IMAGE_SAVE_LIMIT_PER_DAY - 1; i++) {
      await db.insert(s.drafts).values({ userId: A.userId, lessonId: A.lessonId, imageUrl: url(100 + i), imageHash: "old", imageSavedAt: new Date(NOW.getTime() - 60_000) });
    }
    const draftId = await savedDraft(A);
    expect((await saveCampaignImage(deps(), A.userId, { campaignId: A.campaignId, draftId })).code).toBe("image_saved");
    await db.update(s.campaigns).set({ keyMessage: "Changed so a new upload is needed." }).where(eq(s.campaigns.id, A.campaignId));
    const otherCampaignDraft = await db.insert(s.drafts).values({ userId: A.userId, campaignId: A.campaignId, perChannelText: {} }).returning();
    expect((await saveCampaignImage(deps(), A.userId, { campaignId: A.campaignId, draftId: otherCampaignDraft[0].id })).code).toBe("image_limit");
    const lessonDeps: SaveImageDeps = { db: sdb, put: put as unknown as SaveImageDeps["put"], render: render as unknown as SaveImageDeps["render"], now: () => NOW };
    expect((await saveLessonImage(lessonDeps, A.userId, { lessonId: A.lessonId, draftId: A.lessonDraftId })).code).toBe("image_limit");
    expect(put).toHaveBeenCalledTimes(1);
  });
});

describe("delete my data", () => {
  it("removes campaigns, campaign drafts and their buffer_posts with the user (others untouched)", async () => {
    const draftId = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    await db.insert(s.bufferPosts).values({ draftId, channelId: "ch_test_li", service: "linkedin", bufferPostId: "post_FAKE_1" });
    await db.insert(s.results).values({ campaignId: A.campaignId, day: "2026-11-02" });
    await db.delete(s.users).where(eq(s.users.id, A.userId));
    for (const t of ["campaigns", "drafts", "buffer_posts", "results", "products", "lessons"]) {
      const r = await client.query<{ n: number }>(`select count(*)::int as n from ${t}`);
      expect([t, r.rows[0].n]).toEqual([t, t === "campaigns" || t === "products" || t === "lessons" ? 1 : t === "drafts" ? 1 : 0]);
    }
    expect((await db.select().from(s.campaigns))[0].userId).toBe(B.userId);
  });
});
