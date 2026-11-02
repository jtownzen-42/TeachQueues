// What the campaign creative draws, as plain data, plus its hash. Reuses the task 03 helpers.
import { createHash } from "node:crypto";
import { accentFor, CARD_MARK, onAccentFor, stableJson, truncateWords } from "@/lib/graphics/card";

/** Max lengths in code points, ellipsis included (fit the smallest font step of every size). */
export const CREATIVE_LIMITS = { headline: 90, sub: 140, cta: 40, product: 40 } as const;
/** Bump when the drawing changes so saved images from the old design read as out of date. */
export const CREATIVE_DESIGN_VERSION = 1;

export const CREATIVE_SIZES = { square: [1080, 1080], landscape: [1200, 628], story: [1080, 1920] } as const;
export type CreativeSize = keyof typeof CREATIVE_SIZES;
export const CREATIVE_SIZE_KEYS = Object.keys(CREATIVE_SIZES) as CreativeSize[];
export function isCreativeSize(v: unknown): v is CreativeSize {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(CREATIVE_SIZES, v);
}
export const sizeLabel = (s: CreativeSize) => `${CREATIVE_SIZES[s][0]}×${CREATIVE_SIZES[s][1]}`;

export type CampaignCreativeModel = {
  headline: string;
  sub: string;
  cta: string;
  productName: string;
  accent: string;
  onAccent: "#000000" | "#ffffff";
  mark: typeof CARD_MARK;
};

type CampaignIn = { keyMessage: string | null; angle: string | null; cta: string | null };
type ProductIn = { name: string; brandColors: string[] | null | unknown };

export function campaignCreativeModel({ campaign, product }: { campaign: CampaignIn; product: ProductIn }): CampaignCreativeModel {
  const accent = accentFor(product);
  return {
    headline: truncateWords(campaign.keyMessage ?? "", CREATIVE_LIMITS.headline),
    sub: truncateWords(campaign.angle ?? "", CREATIVE_LIMITS.sub),
    cta: truncateWords(campaign.cta ?? "", CREATIVE_LIMITS.cta),
    productName: truncateWords(product.name, CREATIVE_LIMITS.product),
    accent,
    onAccent: onAccentFor(accent),
    mark: CARD_MARK,
  };
}

/** SHA-256 hex of the model plus the design version (size isn't part of it). */
export function creativeModelHash(model: CampaignCreativeModel): string {
  return createHash("sha256").update(stableJson({ v: CREATIVE_DESIGN_VERSION, model })).digest("hex");
}

export function creativeAltText(model: CampaignCreativeModel, size?: CreativeSize): string {
  return `Campaign creative${size ? ` (${sizeLabel(size)})` : ""}: ${model.headline} — ${model.cta} for ${model.productName}`;
}
