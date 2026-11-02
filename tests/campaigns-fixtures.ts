// Shared PGlite fixtures for the Marketing desk tests (not a test file itself).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";
import { approvalState } from "@/lib/campaigns/approval";
import { campaignDraftAll } from "@/lib/campaigns/templates";
import { campaignLinks } from "@/lib/campaigns/utm";
import { approveCampaignDraft, loadOwnedCampaign, saveCampaignVariants } from "@/lib/campaigns/service";

export const NOW = new Date("2026-11-02T15:00:00.000Z");
export const IMG = "https://fake.public.blob.vercel-storage.com/teachqueue/campaigns/x.png";

export function makeDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema: s });
  return { client, db, sdb: db as unknown as SendDb, ready: () => migrate(db, { migrationsFolder: "./drizzle" }) };
}
type Db = ReturnType<typeof makeDb>["db"];

export const BRIEF = {
  name: "Spring Kit", goal: "Get 20 sign-ups to the free sample", audience: "solo shop owners",
  angle: "Free sample with three ready-made templates.", keyMessage: "Plan a week of posts in 20 minutes.", cta: "Get the template",
};

export type Seeded = { userId: string; productId: string; campaignId: string; lessonId: string; lessonDraftId: string };

export async function seedUser(db: Db, acct: string, channels: s.BufferChannel[] = []): Promise<Seeded> {
  const [u] = await db.insert(s.users).values({ bufferAccountId: acct, accessTokenEnc: "enc_FAKE", channelsCache: channels }).returning();
  const [p] = await db.insert(s.products).values({ userId: u.id, name: "Prompt Pantry", url: "https://example.com/kit", brandColors: ["#2563eb"] }).returning();
  const [c] = await db.insert(s.campaigns).values({ userId: u.id, productId: p.id, ...BRIEF }).returning();
  const [l] = await db.insert(s.lessons).values({ productId: p.id, term: "Few-shot", definition: "Examples first." }).returning();
  const [ld] = await db.insert(s.drafts).values({ userId: u.id, lessonId: l.id, perChannelText: { x: "Lesson X text", facebook: "Lesson FB text", linkedin: "Lesson LI text" } }).returning();
  return { userId: u.id, productId: p.id, campaignId: c.id, lessonId: l.id, lessonDraftId: ld.id };
}

/** The template texts for the campaign as it is now in the database. */
export async function templateTexts(sdb: SendDb, userId: string, campaignId: string) {
  const owned = (await loadOwnedCampaign(sdb, userId, campaignId))!;
  const links = campaignLinks(owned.campaign, owned.product!);
  return { links, texts: campaignDraftAll({ keyMessage: owned.campaign.keyMessage!, angle: owned.campaign.angle!, audience: owned.campaign.audience!, cta: owned.campaign.cta! }, owned.product!, links) };
}

/** The approval hash the page would render for the campaign's draft right now. */
export async function currentHash(sdb: SendDb, db: Db, userId: string, campaignId: string, draftId: string) {
  const owned = (await loadOwnedCampaign(sdb, userId, campaignId))!;
  const [d] = await db.select().from(s.drafts).where(eq(s.drafts.id, draftId));
  return approvalState(d, owned.campaign, owned.product!).hash!;
}

/** Save template variants and approve them; returns the approved draft id. */
export async function saveAndApprove(sdb: SendDb, db: Db, userId: string, campaignId: string) {
  const { texts } = await templateTexts(sdb, userId, campaignId);
  const saved = await saveCampaignVariants(sdb, userId, { campaignId, ...texts }, NOW);
  if (saved.code !== "draft_saved") throw new Error(`save failed: ${saved.code}`);
  const hash = await currentHash(sdb, db, userId, campaignId, saved.draftId);
  const r = await approveCampaignDraft(sdb, userId, { campaignId, draftId: saved.draftId, hash, checkAccurate: "yes", checkLink: "yes" }, NOW);
  if (r.code !== "approved") throw new Error(`approve failed: ${r.code}`);
  return r.draftId!;
}
