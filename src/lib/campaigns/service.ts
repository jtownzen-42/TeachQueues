import "server-only";
// Marketing desk services with an injected db (SendDb) so they run on PGlite in tests.
// Every query is scoped by userId; anything that isn't the user's is "not_found" with no write.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { campaigns, drafts, products } from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";
import { fieldErrors, type FieldErrors } from "@/lib/lessons/validation";
import { approvalState } from "./approval";
import { brandNameFor } from "@/lib/graphics/brand";
import { CAMPAIGN_NETWORKS, campaignDraftProblems, campaignTextsFrom, type CampaignTexts } from "./templates";
import { campaignLinks } from "./utm";
import { approveInput, briefInput, variantsInput, type BriefInput } from "./validation";

export type CampaignRow = typeof campaigns.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type DraftRow = typeof drafts.$inferSelect;

/** The campaign and its product, only when both belong to the user (product may be null). */
export async function loadOwnedCampaign(db: SendDb, userId: string, campaignId: string): Promise<{ campaign: CampaignRow; product: ProductRow | null } | null> {
  const [row] = await db.select({ campaign: campaigns, product: products }).from(campaigns)
    .leftJoin(products, and(eq(products.id, campaigns.productId), eq(products.userId, userId)))
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)));
  return row ?? null;
}

/** Newest draft of the campaign in any status (a sent draft is `queued`; edits make a new row). */
export async function latestCampaignDraft(db: SendDb, userId: string, campaignId: string): Promise<DraftRow | null> {
  const [d] = await db.select().from(drafts)
    .where(and(eq(drafts.userId, userId), eq(drafts.campaignId, campaignId)))
    .orderBy(desc(drafts.createdAt), desc(drafts.id)).limit(1);
  return d ?? null;
}

async function ownsProduct(db: SendDb, userId: string, productId: string): Promise<boolean> {
  const [p] = await db.select({ id: products.id }).from(products).where(and(eq(products.id, productId), eq(products.userId, userId)));
  return Boolean(p);
}

const briefColumns = (b: BriefInput) => ({
  productId: b.productId, name: b.name, goal: b.goal, audience: b.audience, angle: b.angle,
  keyMessage: b.keyMessage, cta: b.cta, startsOn: b.startsOn, endsOn: b.endsOn, utmCampaign: b.utmCampaign,
});

export type BriefResult =
  | { ok: true; campaignId: string; code: "campaign_created" | "campaign_saved" }
  | { ok: false; code: "invalid" | "no_product" | "not_found"; fields?: FieldErrors };

export async function createCampaign(db: SendDb, userId: string, raw: unknown, now: Date): Promise<BriefResult> {
  const parsed = briefInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "invalid", fields: fieldErrors(parsed.error) };
  if (!(await ownsProduct(db, userId, parsed.data.productId))) return { ok: false, code: "no_product", fields: { productId: "Pick one of your products." } };
  const [row] = await db.insert(campaigns).values({ userId, ...briefColumns(parsed.data), createdAt: now, updatedAt: now }).returning({ id: campaigns.id });
  return { ok: true, campaignId: row.id, code: "campaign_created" };
}

export async function updateCampaign(db: SendDb, userId: string, campaignId: string, raw: unknown, now: Date): Promise<BriefResult> {
  const parsed = briefInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "invalid", fields: fieldErrors(parsed.error) };
  if (!(await loadOwnedCampaign(db, userId, campaignId))) return { ok: false, code: "not_found" };
  if (!(await ownsProduct(db, userId, parsed.data.productId))) return { ok: false, code: "no_product", fields: { productId: "Pick one of your products." } };
  // Approvals aren't touched here: the approval hash covers the links and creative, so a brief or
  // product change makes any approval out of date automatically.
  await db.update(campaigns).set({ ...briefColumns(parsed.data), updatedAt: now })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)));
  return { ok: true, campaignId, code: "campaign_saved" };
}

export type VariantsResult =
  | { code: "draft_saved"; campaignId: string; draftId: string; wrote: "insert" | "update" | "none" | "new_version" }
  | { code: "variants_invalid"; campaignId: string; fields: FieldErrors }
  | { code: "not_found" | "no_product" };

const sameTexts = (a: CampaignTexts | null, b: CampaignTexts) => Boolean(a) && CAMPAIGN_NETWORKS.every((n) => a![n] === b[n]);

/** Save the four variants. Unchanged -> no write. `approved` + changed -> back to `draft` with the
 *  approval cleared in the same update. `queued` + changed -> a new draft row (Buffer history kept). */
export async function saveCampaignVariants(db: SendDb, userId: string, raw: unknown, now: Date): Promise<VariantsResult> {
  const parsed = variantsInput.safeParse(raw);
  if (!parsed.success) {
    const cid = (raw as { campaignId?: unknown })?.campaignId;
    return typeof cid === "string" && /^[0-9a-f-]{36}$/i.test(cid) ? { code: "variants_invalid", campaignId: cid, fields: fieldErrors(parsed.error) } : { code: "not_found" };
  }
  const { campaignId } = parsed.data;
  const owned = await loadOwnedCampaign(db, userId, campaignId);
  if (!owned) return { code: "not_found" };
  if (!owned.product) return { code: "no_product" };
  const texts: CampaignTexts = { x: parsed.data.x, facebook: parsed.data.facebook, linkedin: parsed.data.linkedin, reddit: parsed.data.reddit };
  const problems = campaignDraftProblems(texts, owned.product, campaignLinks(owned.campaign, owned.product));
  if (Object.keys(problems).length > 0) return { code: "variants_invalid", campaignId, fields: problems as FieldErrors };

  const current = await latestCampaignDraft(db, userId, campaignId);
  if (current && sameTexts(campaignTextsFrom(current.perChannelText), texts)) {
    return { code: "draft_saved", campaignId, draftId: current.id, wrote: "none" };
  }
  const perChannelText: Record<string, string> = { ...texts };
  const touch = () => db.update(campaigns).set({ updatedAt: now }).where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)));
  if (!current || current.status === "queued") {
    // created_at comes from the database clock so versions are strictly ordered (like the Lesson desk).
    const [row] = await db.insert(drafts).values({ userId, campaignId, lessonId: null, perChannelText, status: "draft" })
      .returning({ id: drafts.id });
    await touch();
    return { code: "draft_saved", campaignId, draftId: row.id, wrote: current ? "new_version" : "insert" };
  }
  await db.update(drafts).set({ perChannelText, status: "draft", approvedHash: null, approvedAt: null })
    .where(and(eq(drafts.id, current.id), eq(drafts.userId, userId), inArray(drafts.status, ["draft", "approved"])));
  await touch();
  return { code: "draft_saved", campaignId, draftId: current.id, wrote: "update" };
}

export type ApproveCode = "approved" | "checks_required" | "variants_invalid" | "approval_changed" | "not_found";

/** Approve the exact version the page showed. Both honesty checks must be the literal "yes", the
 *  variants must be valid, and the hash posted by the page must equal the hash recomputed now. */
export async function approveCampaignDraft(db: SendDb, userId: string, raw: unknown, now: Date): Promise<{ code: ApproveCode; campaignId?: string; draftId?: string }> {
  const parsed = approveInput.safeParse(raw);
  if (!parsed.success) return { code: "not_found" };
  const { campaignId, draftId, hash } = parsed.data;
  const owned = await loadOwnedCampaign(db, userId, campaignId);
  if (!owned || !owned.product) return { code: "not_found" };
  const [draft] = await db.select().from(drafts)
    .where(and(eq(drafts.id, draftId), eq(drafts.userId, userId), eq(drafts.campaignId, campaignId)));
  if (!draft) return { code: "not_found", campaignId };
  if (parsed.data.checkAccurate !== "yes" || parsed.data.checkLink !== "yes") return { code: "checks_required", campaignId };

  const state = approvalState(draft, owned.campaign, owned.product, await brandNameFor(db, userId));
  if (!state.hash || Object.keys(state.problems).length > 0) return { code: "variants_invalid", campaignId };
  if (state.hash !== hash) return { code: "approval_changed", campaignId };
  if (draft.approvedHash === state.hash && (draft.status === "approved" || draft.status === "queued")) {
    return { code: "approved", campaignId, draftId }; // already approved: no-op
  }
  if (draft.status === "draft" || draft.status === "approved") {
    await db.update(drafts).set({ status: "approved", approvedHash: state.hash, approvedAt: now })
      .where(and(eq(drafts.id, draft.id), eq(drafts.userId, userId), eq(drafts.status, draft.status)));
    return { code: "approved", campaignId, draftId };
  }
  // A sent (queued) version whose approval went stale (e.g. a new image was saved): its
  // approved_hash is the record of what was sent, so approve a new version instead of rewriting it.
  const [row] = await db.insert(drafts).values({
    userId, campaignId, lessonId: null, perChannelText: draft.perChannelText,
    imageUrl: draft.imageUrl, imageHash: draft.imageHash, imageSavedAt: draft.imageSavedAt,
    status: "approved", approvedHash: state.hash, approvedAt: now,
  }).returning({ id: drafts.id });
  return { code: "approved", campaignId, draftId: row.id };
}

/** Delete a campaign and its unsent drafts in one transaction. Refuses when any draft is approved or
 *  queued (Buffer history). Never touches Buffer. */
export async function deleteCampaignTree(db: SendDb, userId: string, campaignId: string): Promise<"deleted" | "not_found" | "in_use"> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select({ id: campaigns.id }).from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId))).for("update");
    if (!c) return "not_found" as const;
    const [locked] = await tx.select({ id: drafts.id }).from(drafts)
      .where(and(eq(drafts.campaignId, campaignId), sql`${drafts.status} in ('approved', 'queued')`)).limit(1);
    if (locked) return "in_use" as const;
    await tx.delete(drafts).where(and(eq(drafts.campaignId, campaignId), eq(drafts.userId, userId)));
    await tx.delete(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)));
    return "deleted" as const;
  });
}
