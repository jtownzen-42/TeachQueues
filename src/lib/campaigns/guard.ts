// Who may see a campaign creative: the signed-in owner only. Deps are injected so this is testable.
import { idInput } from "@/lib/lessons/validation";
import { campaignCreativeModel, creativeModelHash, isCreativeSize, type CampaignCreativeModel, type CreativeSize } from "./creative";
import { campaignSlug } from "./utm";

type CampaignRow = Parameters<typeof campaignCreativeModel>[0]["campaign"] & { name: string; utmCampaign: string | null };
type ProductRow = Parameters<typeof campaignCreativeModel>[0]["product"];

export type CreativeGuardDeps = {
  /** The session user id if the session is valid and the user row exists, else null. */
  getUserId: () => Promise<string | null>;
  /** The campaign (+ its product, or null) only when it belongs to `userId`. */
  loadCampaign: (userId: string, campaignId: string) => Promise<{ campaign: CampaignRow; product: ProductRow | null } | null>;
};

export type CreativeGuardResult =
  | { status: 401 } | { status: 404 } | { status: 400 }
  | { status: 200; model: CampaignCreativeModel; size: CreativeSize; hash: string; filename: string };

/** Order: signed out 401 -> unknown / other user's / product-less campaign 404 -> bad size 400. */
export async function creativeGuard(deps: CreativeGuardDeps, rawId: unknown, rawSize: unknown): Promise<CreativeGuardResult> {
  const userId = await deps.getUserId();
  if (!userId) return { status: 401 };
  const id = idInput.safeParse(rawId);
  if (!id.success) return { status: 404 };
  const row = await deps.loadCampaign(userId, id.data);
  if (!row || !row.product) return { status: 404 };
  if (!isCreativeSize(rawSize)) return { status: 400 };
  const model = campaignCreativeModel({ campaign: row.campaign, product: row.product });
  // The filename is built only from the validated slug ([a-z0-9-]) and the size key.
  return { status: 200, model, size: rawSize, hash: creativeModelHash(model), filename: `teachqueue-${campaignSlug(row.campaign)}-${rawSize}.png` };
}
