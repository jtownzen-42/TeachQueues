import "server-only";
// "Save square image" for a campaign: same pattern and limits as the lesson graphic (task 03).
// Order: validate -> ownership -> idempotent skip -> storage configured? -> shared daily limit ->
// render (square) -> one upload -> validate URL -> store on the campaign's draft.
import { and, eq } from "drizzle-orm";
import { drafts } from "@/db/schema";
import { countImageSaves, IMAGE_SAVE_LIMIT_PER_DAY, IMAGE_WINDOW_MS, type SaveImageCode, type SaveImageDeps } from "@/lib/graphics/save";
import { currentImageUrl, isPublicBlobUrl } from "@/lib/graphics/blob";
import { campaignCreativeModel, creativeModelHash, type CampaignCreativeModel } from "./creative";
import { loadOwnedCampaign } from "./service";
import { campaignImageInput } from "./validation";

/** Same deps as saveLessonImage, with a renderer for the square campaign creative. */
export type SaveCampaignImageDeps = Omit<SaveImageDeps, "render"> & {
  render: (model: CampaignCreativeModel) => Promise<ArrayBuffer | Uint8Array>;
};
export type SaveCampaignImageResult = { code: SaveImageCode; campaignId?: string; url?: string; uploaded?: boolean };

export function campaignImagePathname(draftId: string, hash: string): string {
  return `teachqueue/campaigns/${draftId}-${hash.slice(0, 12)}.png`;
}

export async function saveCampaignImage(deps: SaveCampaignImageDeps, userId: string, raw: unknown): Promise<SaveCampaignImageResult> {
  const { db } = deps;
  const parsed = campaignImageInput.safeParse(raw);
  if (!parsed.success) return { code: "not_found" };
  const { campaignId, draftId } = parsed.data;

  const owned = await loadOwnedCampaign(db, userId, campaignId);
  if (!owned || !owned.product) return { code: "not_found" };
  const [draft] = await db.select().from(drafts)
    .where(and(eq(drafts.id, draftId), eq(drafts.userId, userId), eq(drafts.campaignId, campaignId)));
  if (!draft) return { code: "not_found", campaignId };

  const model = campaignCreativeModel({ campaign: owned.campaign, product: owned.product });
  const hash = creativeModelHash(model);
  const existing = currentImageUrl(draft, hash);
  if (existing) return { code: "image_saved", campaignId, url: existing, uploaded: false };

  if (deps.storageReady === false) return { code: "image_storage_off", campaignId };
  const now = deps.now();
  // Shared with lesson images: countImageSaves counts every draft of the user.
  if ((await countImageSaves(db, userId, new Date(now.getTime() - IMAGE_WINDOW_MS))) >= IMAGE_SAVE_LIMIT_PER_DAY) {
    return { code: "image_limit", campaignId };
  }

  let url: string;
  try {
    const png = await deps.render(model);
    const body = Buffer.from(png instanceof Uint8Array ? png : new Uint8Array(png));
    const res = await deps.put(campaignImagePathname(draftId, hash), body, { access: "public", addRandomSuffix: true, contentType: "image/png" });
    url = res?.url;
  } catch (e) {
    console.error("[teachqueue] campaign image save failed", (e as { name?: string })?.name, (e as { status?: number })?.status ?? "");
    return { code: "image_failed", campaignId };
  }
  if (!isPublicBlobUrl(url)) {
    console.error("[teachqueue] campaign image save failed", "UnexpectedBlobUrl");
    return { code: "image_failed", campaignId };
  }
  // Metadata only (status/texts untouched). A new image changes the approval hash, so any
  // approval becomes out of date by itself. Old blobs are kept (a Buffer draft may still use them).
  await db.update(drafts).set({ imageUrl: url, imageHash: hash, imageSavedAt: now })
    .where(and(eq(drafts.id, draftId), eq(drafts.userId, userId)));
  return { code: "image_saved", campaignId, url, uploaded: true };
}

export { IMAGE_SAVE_LIMIT_PER_DAY };
