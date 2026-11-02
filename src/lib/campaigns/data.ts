import "server-only";
// Marketing desk reads for the pages. getDb(), every function takes userId first and scopes by it.
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { bufferPosts, campaigns, drafts, products } from "@/db/schema";
import { latestCampaignDraft, loadOwnedCampaign } from "./service";

export type CampaignStatusWord = "No copy yet" | "Draft" | "Approved" | "In Buffer";

/** The user's campaigns, newest first, with product name and a status word from the newest draft. */
export async function listCampaigns(userId: string) {
  const db = getDb();
  const rows = await db.select({ campaign: campaigns, productName: products.name }).from(campaigns)
    .leftJoin(products, and(eq(products.id, campaigns.productId), eq(products.userId, userId)))
    .where(eq(campaigns.userId, userId))
    .orderBy(desc(campaigns.createdAt), desc(campaigns.id));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.campaign.id);
  const ds = await db.select({ id: drafts.id, campaignId: drafts.campaignId, status: drafts.status, createdAt: drafts.createdAt }).from(drafts)
    .where(and(eq(drafts.userId, userId), inArray(drafts.campaignId, ids)))
    .orderBy(desc(drafts.createdAt), desc(drafts.id));
  const newest = new Map<string, (typeof ds)[number]>();
  for (const d of ds) if (d.campaignId && !newest.has(d.campaignId)) newest.set(d.campaignId, d);
  const newestIds = [...newest.values()].map((d) => d.id);
  const sent = newestIds.length
    ? await db.select({ draftId: bufferPosts.draftId }).from(bufferPosts)
        .where(and(inArray(bufferPosts.draftId, newestIds), isNotNull(bufferPosts.bufferPostId)))
    : [];
  const sentSet = new Set(sent.map((s) => s.draftId));
  return rows.map(({ campaign, productName }) => {
    const d = newest.get(campaign.id);
    const status: CampaignStatusWord = !d ? "No copy yet" : sentSet.has(d.id) ? "In Buffer" : d.status === "approved" || d.status === "queued" ? "Approved" : "Draft";
    return { campaign, productName, status };
  });
}

export async function getCampaign(userId: string, campaignId: string) {
  return loadOwnedCampaign(getDb(), userId, campaignId);
}

export async function getLatestCampaignDraft(userId: string, campaignId: string) {
  return latestCampaignDraft(getDb(), userId, campaignId);
}

/** Every Buffer send for this campaign's drafts (newest first), scoped to the user. */
export async function listCampaignBufferPosts(userId: string, campaignId: string) {
  return getDb().select({ post: bufferPosts, draftId: drafts.id }).from(bufferPosts)
    .innerJoin(drafts, eq(drafts.id, bufferPosts.draftId))
    .where(and(eq(drafts.userId, userId), eq(drafts.campaignId, campaignId)))
    .orderBy(desc(bufferPosts.createdAt));
}
