// "Approve exact version": a hash over exactly what would be sent. Everything is recomputed from
// database rows, so any change (a variant edit, the brief or product, a new image) changes the hash.
import { createHash } from "node:crypto";
import { stableJson } from "@/lib/graphics/card";
import { currentImageUrl } from "@/lib/graphics/blob";
import { campaignCreativeModel, creativeModelHash } from "./creative";
import { campaignDraftProblems, campaignTextsFrom, type CampaignNetwork, type CampaignTexts } from "./templates";
import { campaignLinks, type CampaignLinks } from "./utm";

export const APPROVAL_VERSION = 1;

/** SHA-256 hex of stableJson({ v: 1, texts: {x, facebook, linkedin, reddit}, links, imageHash }). */
export function approvalHash({ texts, links, imageHash }: { texts: CampaignTexts; links: CampaignLinks; imageHash: string | null }): string {
  const t = { x: texts.x, facebook: texts.facebook, linkedin: texts.linkedin, reddit: texts.reddit };
  return createHash("sha256").update(stableJson({ v: APPROVAL_VERSION, texts: t, links, imageHash })).digest("hex");
}

type CampaignRow = { name: string; utmCampaign: string | null; keyMessage: string | null; angle: string | null; cta: string | null };
type ProductRow = { name: string; url: string; brandColors: string[] | null | unknown };
type DraftRow = { perChannelText: Record<string, string> | null; imageUrl: string | null; imageHash: string | null };

export type ApprovalState = {
  texts: CampaignTexts | null;
  links: CampaignLinks;
  creativeHash: string;
  /** The draft's image hash, only when that image is the current creative (else null). */
  imageHash: string | null;
  imageUrl: string | null;
  problems: Partial<Record<CampaignNetwork, string>>;
  /** null when the draft lacks a text for any network (can't be approved). */
  hash: string | null;
};

/** Everything approval and sending need, from the draft + campaign + product rows. */
export function approvalState(draft: DraftRow, campaign: CampaignRow, product: ProductRow): ApprovalState {
  const links = campaignLinks(campaign, product);
  const creativeHash = creativeModelHash(campaignCreativeModel({ campaign, product }));
  const imageUrl = currentImageUrl(draft, creativeHash);
  const imageHash = imageUrl ? draft.imageHash : null;
  const texts = campaignTextsFrom(draft.perChannelText);
  const problems = texts ? campaignDraftProblems(texts, product, links) : { x: "Save the variants first." };
  return { texts, links, creativeHash, imageHash, imageUrl, problems, hash: texts ? approvalHash({ texts, links, imageHash }) : null };
}

/** True when the draft's stored approval matches what would be sent now. */
export function isApprovalCurrent(draft: { status: string; approvedHash: string | null }, state: ApprovalState): boolean {
  return (draft.status === "approved" || draft.status === "queued") && Boolean(draft.approvedHash) && draft.approvedHash === state.hash;
}
