// Deterministic, template-only campaign copy per network (no AI, no network). Every word comes
// from the user's brief/product plus the fixed template text below. Pure: runs in the browser.
import { charCount, hashtagFor, LIMITS, NETWORK_LABELS, plural } from "@/lib/lessons/templates";
import type { CampaignLinks } from "./utm";

export const CAMPAIGN_NETWORKS = ["x", "facebook", "linkedin", "reddit"] as const;
export type CampaignNetwork = (typeof CAMPAIGN_NETWORKS)[number];
/** Networks that can go to Buffer. Reddit is copy-only (Buffer doesn't support it). */
export const SENDABLE_CAMPAIGN_NETWORKS = ["x", "facebook", "linkedin"] as const;

export const CAMPAIGN_NETWORK_LABELS: Record<CampaignNetwork, string> = { ...NETWORK_LABELS, reddit: "Reddit (copy only)" };
/** X 280 (weighted, links = 23), Facebook 2,000 and LinkedIn 3,000 from the Lesson desk; Reddit 3,000 code points (TeachQueue's cap). */
export const CAMPAIGN_LIMITS: Record<CampaignNetwork, number> = { ...LIMITS, reddit: 3000 };
export const REDDIT_NOTE = "Copy only. Reddit isn't supported by Buffer, so TeachQueue never sends it.";

export type CampaignTexts = Record<CampaignNetwork, string>;
export type BriefFields = { keyMessage: string; angle: string; audience: string; cta: string };
export type ProductName = { name: string };

export function campaignCharCount(text: string, network: CampaignNetwork): number {
  return network === "reddit" ? [...text.normalize("NFC")].length : charCount(text, network);
}

export function isSendableCampaignNetwork(n: string): n is (typeof SENDABLE_CAMPAIGN_NETWORKS)[number] {
  return (SENDABLE_CAMPAIGN_NETWORKS as readonly string[]).includes(n);
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();

type Parts = { keyMessage: string; angle: string; audience: string };

function assemble(network: CampaignNetwork, f: Parts, cta: string, productName: string, link: string): string {
  const close = `${cta} → ${productName}: ${link}`;
  switch (network) {
    case "x":
      return [f.keyMessage, f.angle, close].filter(Boolean).join("\n\n");
    case "facebook":
      return [f.keyMessage, f.angle, f.audience && `For ${f.audience}.`, close].filter(Boolean).join("\n\n");
    case "linkedin":
      return [f.keyMessage, f.angle, f.audience && `For ${f.audience}.`, hashtagFor(productName), close].filter(Boolean).join("\n\n");
    case "reddit":
      return [
        f.keyMessage,
        f.angle,
        f.audience && `Who it's for: ${f.audience}.`,
        `Disclosure: I make ${productName}. ${cta}:\n${link}`,
      ].filter(Boolean).join("\n\n");
  }
}

/** Shorten to at most `max` code points on a word boundary, ending with "…" ("" if max < 2). */
export function shortenWords(s: string, max: number): string {
  const cps = [...s];
  if (cps.length <= max) return s;
  if (max < 2) return "";
  const room = cps.slice(0, max - 1).join("");
  const sp = room.lastIndexOf(" ");
  const cut = sp >= Math.floor(room.length / 2) ? room.slice(0, sp) : room;
  return cut.replace(/[\s.,;:!?\-–—(\[{"'“‘]+$/u, "") + "…";
}

/** Draft one network's copy. If it runs over the limit, the angle, then the audience, then the
 *  key message are trimmed on word boundaries (with "…") so the product name, CTA and link always
 *  survive. If even that can't fit, the over-limit text is returned and the UI shows the error. */
export function campaignDraftFor(brief: BriefFields, product: ProductName, network: CampaignNetwork, link: string): string {
  const parts: Parts = { keyMessage: clean(brief.keyMessage), angle: clean(brief.angle), audience: clean(brief.audience) };
  const cta = clean(brief.cta);
  const name = product.name.trim();
  const limit = CAMPAIGN_LIMITS[network];
  const mins: Record<keyof Parts, number> = { angle: 0, audience: 0, keyMessage: 16 };
  let text = assemble(network, parts, cta, name, link);
  for (const key of ["angle", "audience", "keyMessage"] as const) {
    let guard = 0;
    while (campaignCharCount(text, network) > limit && parts[key] && guard++ < 60) {
      const len = [...parts[key]].length;
      const target = len - (campaignCharCount(text, network) - limit);
      const next = target < Math.max(mins[key], 8) ? (mins[key] === 0 ? "" : shortenWords(parts[key], mins[key])) : shortenWords(parts[key], target);
      if (next === parts[key]) break;
      parts[key] = next;
      text = assemble(network, parts, cta, name, link);
      if (mins[key] > 0 && [...parts[key]].length <= mins[key]) break;
    }
  }
  return text;
}

export function campaignDraftAll(brief: BriefFields, product: ProductName, links: CampaignLinks): CampaignTexts {
  return {
    x: campaignDraftFor(brief, product, "x", links.x),
    facebook: campaignDraftFor(brief, product, "facebook", links.facebook),
    linkedin: campaignDraftFor(brief, product, "linkedin", links.linkedin),
    reddit: campaignDraftFor(brief, product, "reddit", links.reddit),
  };
}

/** True when `link` appears as a whole link: preceded by start, whitespace or "(", and followed by
 *  end, whitespace, ")" or sentence punctuation that ends the token. So "...utm_campaign=spring-kitXYZ"
 *  or "...spring-kit&ref=2" (a different URL that merely starts with the right one) doesn't count. */
export function containsExactLink(text: string, link: string): boolean {
  if (!link) return false;
  let i = text.indexOf(link);
  while (i !== -1) {
    const before = i === 0 ? "" : text[i - 1];
    const rest = text.slice(i + link.length);
    const okBefore = before === "" || /\s|\(/.test(before);
    const okAfter = rest === "" || /^[\s)]/.test(rest) || /^[.,!?;:]+(?:\s|\)|$)/.test(rest);
    if (okBefore && okAfter) return true;
    i = text.indexOf(link, i + 1);
  }
  return false;
}

/** Problems that block saving and approving: empty, over the limit, missing that network's exact
 *  final link, or missing the exact product name. */
export function campaignDraftProblems(texts: Partial<CampaignTexts>, product: ProductName, links: CampaignLinks): Partial<Record<CampaignNetwork, string>> {
  const out: Partial<Record<CampaignNetwork, string>> = {};
  const name = product.name.trim();
  for (const n of CAMPAIGN_NETWORKS) {
    const t = (texts[n] ?? "").trim();
    const label = CAMPAIGN_NETWORK_LABELS[n];
    const count = campaignCharCount(t, n);
    if (!t) out[n] = `${label} text is empty.`;
    else if (count > CAMPAIGN_LIMITS[n]) out[n] = `${label} text is ${plural(count - CAMPAIGN_LIMITS[n], "character")} over the ${CAMPAIGN_LIMITS[n].toLocaleString("en-US")} limit.`;
    else if (!containsExactLink(t, links[n])) out[n] = `${label} text must include its tracking link exactly: ${links[n]}`;
    else if (!t.includes(name)) out[n] = `${label} text must include the product name exactly: ${name}`;
  }
  return out;
}

export function campaignTextsFrom(per: Record<string, string> | null | undefined): CampaignTexts | null {
  if (!per || !CAMPAIGN_NETWORKS.every((n) => typeof per[n] === "string")) return null;
  return { x: per.x, facebook: per.facebook, linkedin: per.linkedin, reddit: per.reddit };
}
