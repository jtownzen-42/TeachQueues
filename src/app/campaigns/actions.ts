"use server";
// Marketing desk Server Actions: Origin check -> session -> service (zod + user-scoped queries) ->
// redirect with a whitelisted notice. All the rules live in src/lib/campaigns/* and src/lib/buffer/send.ts.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { drafts } from "@/db/schema";
import type { FormState } from "@/app/products/actions";
import { getValidAccessToken } from "@/lib/buffer/tokens";
import { sendDraftToBuffer } from "@/lib/buffer/send";
import { parseId, requestIsSameOrigin, requireUserId } from "@/lib/lessons/data";
import { formFields } from "@/lib/lessons/validation";
import {
  approveCampaignDraft as approveService, createCampaign as createService, deleteCampaignTree,
  saveCampaignVariants as saveVariantsService, updateCampaign as updateService,
} from "@/lib/campaigns/service";
import { saveCampaignImage } from "@/lib/campaigns/save";
import { renderCampaignCreativePng } from "@/lib/campaigns/render";
import { APPROVE_FIELDS, BRIEF_FIELDS, VARIANT_FIELDS } from "@/lib/campaigns/validation";

const FORBIDDEN = "That request came from another site, so it was ignored.";
const NOT_FOUND = "That item doesn't exist or isn't yours.";
const FAILED = "Something went wrong saving that. Please try again.";
const back = (campaignId: string | null, code: string, section = "") =>
  campaignId ? `/campaigns/${campaignId}?n=${code}${section ? `#${section}` : ""}` : `/campaigns?n=${code}`;

function fail(prev: FormState, values: FormState["values"], extra: Partial<FormState>): FormState {
  return { nonce: prev.nonce + 1, values, ...extra };
}

// ---------- Brief ----------

export async function createCampaign(prev: FormState, fd: FormData): Promise<FormState> {
  const values = formFields(fd, BRIEF_FIELDS);
  if (!(await requestIsSameOrigin())) return fail(prev, values, { error: FORBIDDEN });
  const userId = await requireUserId();
  let r: Awaited<ReturnType<typeof createService>>;
  try {
    r = await createService(getDb(), userId, values, new Date());
  } catch (e) {
    console.error("[teachqueue] create campaign failed", (e as Error)?.name);
    return fail(prev, values, { error: FAILED });
  }
  if (!r.ok) return fail(prev, values, { error: r.code === "no_product" ? "Pick one of your products." : "Please fix the highlighted fields.", fields: r.fields });
  revalidatePath("/campaigns");
  redirect(back(r.campaignId, r.code));
}

export async function updateCampaign(prev: FormState, fd: FormData): Promise<FormState> {
  const values = formFields(fd, BRIEF_FIELDS);
  if (!(await requestIsSameOrigin())) return fail(prev, values, { error: FORBIDDEN });
  const userId = await requireUserId();
  const campaignId = parseId(fd.get("campaignId"));
  if (!campaignId) return fail(prev, values, { error: NOT_FOUND });
  let r: Awaited<ReturnType<typeof updateService>>;
  try {
    r = await updateService(getDb(), userId, campaignId, values, new Date());
  } catch (e) {
    console.error("[teachqueue] update campaign failed", (e as Error)?.name);
    return fail(prev, values, { error: FAILED });
  }
  if (!r.ok) {
    if (r.code === "not_found") return fail(prev, values, { error: NOT_FOUND });
    return fail(prev, values, { error: r.code === "no_product" ? "Pick one of your products." : "Please fix the highlighted fields.", fields: r.fields });
  }
  revalidatePath(`/campaigns/${campaignId}`);
  redirect(back(campaignId, r.code, "brief"));
}

// ---------- Variants ----------

export async function saveCampaignVariants(prev: FormState, fd: FormData): Promise<FormState> {
  const values = formFields(fd, VARIANT_FIELDS);
  if (!(await requestIsSameOrigin())) return fail(prev, values, { error: FORBIDDEN });
  const userId = await requireUserId();
  let r: Awaited<ReturnType<typeof saveVariantsService>>;
  try {
    r = await saveVariantsService(getDb(), userId, values, new Date());
  } catch (e) {
    console.error("[teachqueue] save campaign variants failed", (e as Error)?.name);
    return fail(prev, values, { error: FAILED });
  }
  if (r.code === "variants_invalid") return fail(prev, values, { error: "Some variants need fixing before they can be saved. See the notes under each one.", fields: r.fields });
  if (r.code !== "draft_saved") return fail(prev, values, { error: r.code === "no_product" ? "Pick one of your products." : NOT_FOUND });
  revalidatePath(`/campaigns/${r.campaignId}`);
  redirect(back(r.campaignId, "draft_saved", "variants"));
}

// ---------- Square image (Blob) ----------

export async function saveCampaignImageAction(fd: FormData): Promise<void> {
  const campaignId = parseId(fd.get("campaignId"));
  if (!(await requestIsSameOrigin())) redirect(back(campaignId, "forbidden", "creative"));
  const userId = await requireUserId();
  let code: string;
  try {
    // put() reads BLOB_READ_WRITE_TOKEN from the environment; it is never passed or logged here.
    const r = await saveCampaignImage(
      {
        db: getDb(), put: (pathname, body, opts) => put(pathname, body, opts),
        render: (m) => renderCampaignCreativePng(m, "square"), now: () => new Date(),
        storageReady: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      },
      userId,
      formFields(fd, ["campaignId", "draftId"]),
    );
    code = r.code;
  } catch (e) {
    console.error("[teachqueue] save campaign image crashed", (e as Error)?.name);
    code = "image_failed";
  }
  if (campaignId) revalidatePath(`/campaigns/${campaignId}`);
  redirect(back(campaignId, code, "creative"));
}

// ---------- Approve exact version ----------

export async function approveCampaignDraft(fd: FormData): Promise<void> {
  const campaignId = parseId(fd.get("campaignId"));
  if (!(await requestIsSameOrigin())) redirect(back(campaignId, "forbidden", "approve"));
  const userId = await requireUserId();
  let code: string;
  try {
    code = (await approveService(getDb(), userId, formFields(fd, APPROVE_FIELDS), new Date())).code;
  } catch (e) {
    console.error("[teachqueue] approve campaign failed", (e as Error)?.name);
    code = "error";
  }
  if (campaignId) revalidatePath(`/campaigns/${campaignId}`);
  redirect(back(campaignId, code, "approve"));
}

// ---------- Send (through the shared send service) ----------

export async function sendCampaignToBuffer(fd: FormData): Promise<void> {
  const backId = parseId(fd.get("campaignId"));
  if (!(await requestIsSameOrigin())) redirect(back(backId, "forbidden", "send"));
  const userId = await requireUserId();
  // Only these fields are read; anything else in the form (e.g. saveToDraft, imageUrl, network) is ignored.
  const raw = formFields(fd, ["draftId", "channelId", "mode", "local", "confirmAnother", "attachImage"]);
  // This form only sends drafts of this campaign (a lesson draft id posted here is refused).
  const draftId = parseId(raw.draftId);
  if (!backId || !draftId) redirect(back(backId, "not_found", "send"));
  const [own] = await getDb().select({ id: drafts.id }).from(drafts)
    .where(and(eq(drafts.id, draftId), eq(drafts.userId, userId), eq(drafts.campaignId, backId)));
  if (!own) redirect(back(backId, "not_found", "send"));
  let result: Awaited<ReturnType<typeof sendDraftToBuffer>>;
  try {
    result = await sendDraftToBuffer(
      { db: getDb(), getToken: getValidAccessToken, now: () => new Date(), envTestMode: process.env.TEST_MODE },
      userId,
      { ...raw, local: raw.mode === "custom" ? raw.local : undefined, confirmAnother: raw.confirmAnother || undefined, attachImage: raw.attachImage || undefined },
    );
  } catch (e) {
    console.error("[teachqueue] campaign send crashed", (e as Error)?.name);
    redirect(back(backId, "error", "send"));
  }
  const campaignId = result.campaignId ?? backId;
  if (campaignId) revalidatePath(`/campaigns/${campaignId}`);
  const wait = result.code === "busy" && result.retryAfter ? `&wait=${Math.max(1, Math.ceil(result.retryAfter / 60))}` : "";
  redirect(campaignId ? `/campaigns/${campaignId}?n=${result.code}${wait}#send` : `/campaigns?n=${result.code}`);
}

// ---------- Delete ----------

export async function deleteCampaign(fd: FormData): Promise<void> {
  const campaignId = parseId(fd.get("campaignId"));
  if (!(await requestIsSameOrigin())) redirect(back(campaignId, "forbidden"));
  const userId = await requireUserId();
  if (!campaignId) redirect("/campaigns?n=not_found");
  let r: Awaited<ReturnType<typeof deleteCampaignTree>>;
  try {
    r = await deleteCampaignTree(getDb(), userId, campaignId);
  } catch (e) {
    console.error("[teachqueue] delete campaign failed", (e as Error)?.name);
    redirect(back(campaignId, "error"));
  }
  if (r === "in_use") redirect(back(campaignId, "campaign_in_use"));
  if (r === "not_found") redirect("/campaigns?n=not_found");
  revalidatePath("/campaigns");
  redirect("/campaigns?n=campaign_deleted");
}
