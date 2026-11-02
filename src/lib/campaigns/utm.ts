// UTM-tagged links per network. Pure (runs in the browser for the editor).
import type { CampaignNetwork } from "./templates";

export const UTM_SOURCE: Record<CampaignNetwork, string> = { x: "x", facebook: "facebook", linkedin: "linkedin", reddit: "reddit" };
export const UTM_MEDIUM = "social";
export const MAX_URL_LENGTH = 2048;
const UTM_KEYS = new Set(["utm_source", "utm_medium", "utm_campaign"]);

/** Lower-case ASCII slug: diacritics stripped (NFKD), runs of anything else -> "-", max 60
 *  (cut on a dash when possible), "campaign" when nothing is left. */
export function slugify(name: string | null | undefined): string {
  const base = (name ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let slug = base;
  if (slug.length > 60) {
    const cut = slug.slice(0, 60);
    const dash = cut.lastIndexOf("-");
    slug = (dash >= 20 ? cut.slice(0, dash) : cut).replace(/-+$/g, "");
  }
  return slug || "campaign";
}

export type CampaignForLinks = { name: string; utmCampaign: string | null };

/** utm_campaign value: the saved slug, else slugify(name). */
export function campaignSlug(c: CampaignForLinks): string {
  return c.utmCampaign && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.utmCampaign) ? c.utmCampaign : slugify(c.name);
}

/** Add utm_source / utm_medium / utm_campaign to an https URL. The path, every other query
 *  parameter (in its original order and encoding) and the #hash are kept; existing utm_* of
 *  those three keys are replaced, never duplicated. Throws for non-https or > 2,048 chars. */
export function buildUtmUrl(productUrl: string, utm: { source: string; medium: string; campaign: string }): string {
  const u = new URL(productUrl);
  if (u.protocol !== "https:") throw new Error("Product URL must be https");
  const keep = u.search.replace(/^\?/, "").split("&").filter((pair) => {
    if (!pair) return false;
    const rawKey = pair.split("=")[0];
    let key = rawKey;
    try { key = decodeURIComponent(rawKey.replace(/\+/g, " ")); } catch { /* keep raw */ }
    return !UTM_KEYS.has(key.toLowerCase());
  });
  const add = [
    `utm_source=${encodeURIComponent(utm.source)}`,
    `utm_medium=${encodeURIComponent(utm.medium)}`,
    `utm_campaign=${encodeURIComponent(utm.campaign)}`,
  ];
  u.search = `?${[...keep, ...add].join("&")}`;
  const out = u.toString();
  if (out.length > MAX_URL_LENGTH) throw new Error("Tagged URL is too long");
  return out;
}

export type CampaignLinks = Record<CampaignNetwork, string>;

/** The final link per network that every variant must contain. */
export function campaignLinks(campaign: CampaignForLinks, product: { url: string }): CampaignLinks {
  const campaignValue = campaignSlug(campaign);
  const link = (n: CampaignNetwork) => buildUtmUrl(product.url, { source: UTM_SOURCE[n], medium: UTM_MEDIUM, campaign: campaignValue });
  return { x: link("x"), facebook: link("facebook"), linkedin: link("linkedin"), reddit: link("reddit") };
}
