import "server-only";
// Results for one campaign, per day. Injected db; every query proves campaign.user_id = user.
import { and, desc, eq, inArray } from "drizzle-orm";
import { bufferPosts, campaigns, drafts, results } from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";
import { fieldErrors, type FieldErrors } from "@/lib/lessons/validation";
import { centsToNumeric } from "./money";
import { toResultRow, type ResultRow } from "./summary";
import { deleteResultInput, resultInput } from "./validation";

const ownedCampaignIds = (db: SendDb, userId: string) => db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.userId, userId));

async function ownsCampaign(db: SendDb, userId: string, campaignId: string): Promise<boolean> {
  const [c] = await db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)));
  return Boolean(c);
}

export type SaveResultOutcome =
  | { code: "result_saved"; campaignId: string; day: string }
  | { code: "result_invalid"; campaignId?: string; fields: FieldErrors }
  | { code: "not_found" };

/** Add or update one day (upsert on the unique (campaign_id, day) index). */
export async function saveResultDay(db: SendDb, userId: string, raw: unknown, tz: string, now: Date): Promise<SaveResultOutcome> {
  const parsed = resultInput(tz, now).safeParse(raw);
  if (!parsed.success) {
    const cid = (raw as { campaignId?: unknown })?.campaignId;
    return { code: "result_invalid", campaignId: typeof cid === "string" ? cid : undefined, fields: fieldErrors(parsed.error) };
  }
  const v = parsed.data;
  if (!(await ownsCampaign(db, userId, v.campaignId))) return { code: "not_found" };
  const values = {
    campaignId: v.campaignId, day: v.day, visits: v.visits, purchases: v.purchases,
    revenue: centsToNumeric(v.revenue), fees: centsToNumeric(v.fees), refunds: centsToNumeric(v.refunds), adSpend: centsToNumeric(v.adSpend),
  };
  await db.insert(results).values({ ...values, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [results.campaignId, results.day],
      set: { visits: values.visits, purchases: values.purchases, revenue: values.revenue, fees: values.fees, refunds: values.refunds, adSpend: values.adSpend, updatedAt: now },
      // the conflicting row's campaign is already proven to be the user's (same campaign_id)
    });
  return { code: "result_saved", campaignId: v.campaignId, day: v.day };
}

export async function deleteResultDay(db: SendDb, userId: string, raw: unknown): Promise<{ code: "result_deleted" | "not_found"; campaignId?: string }> {
  const parsed = deleteResultInput.safeParse(raw);
  if (!parsed.success) return { code: "not_found" };
  const { campaignId, day } = parsed.data;
  const gone = await db.delete(results)
    .where(and(eq(results.campaignId, campaignId), eq(results.day, day), inArray(results.campaignId, ownedCampaignIds(db, userId))))
    .returning({ id: results.id });
  return gone.length ? { code: "result_deleted", campaignId } : { code: "not_found", campaignId };
}

/** The campaign's days, newest first, as integer cents (empty if not the user's). */
export async function listResultDays(db: SendDb, userId: string, campaignId: string): Promise<ResultRow[]> {
  const rows = await db.select({
    day: results.day, visits: results.visits, purchases: results.purchases,
    revenue: results.revenue, fees: results.fees, refunds: results.refunds, adSpend: results.adSpend,
  }).from(results)
    .where(and(eq(results.campaignId, campaignId), inArray(results.campaignId, ownedCampaignIds(db, userId))))
    .orderBy(desc(results.day));
  return rows.map(toResultRow);
}

/** The campaign's buffer_posts rows (scoped to the user), for the "sent posts" line-up and count. */
export async function campaignPosts(db: SendDb, userId: string, campaignId: string) {
  return db.select({ post: bufferPosts }).from(bufferPosts)
    .innerJoin(drafts, eq(drafts.id, bufferPosts.draftId))
    .where(and(eq(drafts.userId, userId), eq(drafts.campaignId, campaignId)))
    .orderBy(desc(bufferPosts.createdAt));
}

/** Sent posts = rows whose last read-back said `sent`. */
export function sentPostCount(rows: { post: { bufferStatus: string | null } }[]): number {
  return rows.filter((r) => r.post.bufferStatus === "sent").length;
}
