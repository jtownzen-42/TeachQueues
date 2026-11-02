import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_LIMITS, CAMPAIGN_NETWORKS, campaignCharCount, campaignDraftAll, campaignDraftFor, campaignDraftProblems,
  isSendableCampaignNetwork, shortenWords,
} from "@/lib/campaigns/templates";
import { campaignLinks } from "@/lib/campaigns/utm";
import { charCount } from "@/lib/lessons/templates";
import { networkForService } from "@/lib/buffer/posts";

const product = { name: "Prompt Pantry", url: "https://example.com/kit" };
const links = campaignLinks({ name: "Spring Kit", utmCampaign: null }, product);
const brief = { keyMessage: "Plan a week of posts in 20 minutes.", angle: "Free sample with three ready-made templates.", audience: "solo shop owners", cta: "Get the template" };
const words = (n: number, w: string) => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");
const longBrief = { keyMessage: words(45, "key").slice(0, 280), angle: words(50, "angle").slice(0, 300), audience: words(35, "aud").slice(0, 200), cta: "Get the template" };

describe("campaignDraftFor", () => {
  it("is deterministic and every variant has its exact link and the product name", () => {
    const a = campaignDraftAll(brief, product, links);
    expect(campaignDraftAll({ ...brief }, { ...product }, { ...links })).toEqual(a);
    for (const n of CAMPAIGN_NETWORKS) {
      expect(a[n]).toContain(links[n]);
      expect(a[n]).toContain("Prompt Pantry");
      expect(a[n].startsWith(brief.keyMessage)).toBe(true);
    }
  });
  it("uses the documented shapes", () => {
    const a = campaignDraftAll(brief, product, links);
    expect(a.x).toBe(`${brief.keyMessage}\n\n${brief.angle}\n\nGet the template → Prompt Pantry: ${links.x}`);
    expect(a.facebook).toBe(`${brief.keyMessage}\n\n${brief.angle}\n\nFor solo shop owners.\n\nGet the template → Prompt Pantry: ${links.facebook}`);
    expect(a.linkedin).toBe(`${brief.keyMessage}\n\n${brief.angle}\n\nFor solo shop owners.\n\n#PromptPantry\n\nGet the template → Prompt Pantry: ${links.linkedin}`);
    expect(a.reddit).toBe(`${brief.keyMessage}\n\n${brief.angle}\n\nWho it's for: solo shop owners.\n\nDisclosure: I make Prompt Pantry. Get the template:\n${links.reddit}`);
    for (const n of ["x", "facebook", "reddit"] as const) expect(a[n]).not.toContain("#");
    expect(JSON.stringify(a)).not.toMatch(/BufferCommit/i);
  });
  it("X stays <= 280 weighted with a long brief (link counted as 23), keeping CTA, product and link", () => {
    const x = campaignDraftFor(longBrief, product, "x", links.x);
    expect(charCount(x, "x")).toBeLessThanOrEqual(280);
    expect(x.endsWith(`Get the template → Prompt Pantry: ${links.x}`)).toBe(true);
    expect(x).toContain("…");
    expect(x.length).toBeGreaterThan(280); // the long link is counted as 23 by X, not its real length
  });
  it("trims angle first, then audience, then key message", () => {
    // Facebook 2,000 never trims this brief; force a tight limit through X with a short key message.
    const b = { keyMessage: "Short key message here.", angle: words(60, "angle"), audience: "solo shop owners", cta: "Get it" };
    const x = campaignDraftFor(b, product, "x", links.x);
    expect(x.startsWith("Short key message here.")).toBe(true); // key message intact
    expect(x).toContain("angle0");
    expect(charCount(x, "x")).toBeLessThanOrEqual(280);
  });
  it("every network fits its limit with the longest allowed brief", () => {
    const all = campaignDraftAll(longBrief, product, links);
    for (const n of CAMPAIGN_NETWORKS) expect(campaignCharCount(all[n], n)).toBeLessThanOrEqual(CAMPAIGN_LIMITS[n]);
    expect(campaignDraftProblems(all, product, links)).toEqual({});
  });
  it("returns over-limit text when product + CTA + link alone can't fit on X", () => {
    const x = campaignDraftFor(brief, { name: "N".repeat(300) }, "x", links.x);
    expect(campaignCharCount(x, "x")).toBeGreaterThan(280);
    expect(x).toContain(links.x);
  });
  it("shortenWords cuts on a word boundary with an ellipsis", () => {
    expect(shortenWords("alpha beta gamma delta", 12)).toBe("alpha beta…");
    expect(shortenWords("short", 10)).toBe("short");
  });
});

describe("campaignDraftProblems", () => {
  const ok = campaignDraftAll(brief, product, links);
  it("passes template output", () => expect(campaignDraftProblems(ok, product, links)).toEqual({}));
  it("flags empty, over limit, missing link and wrong product name", () => {
    const p = campaignDraftProblems({
      x: "", facebook: `${"b".repeat(2001)} Prompt Pantry ${links.facebook}`,
      linkedin: ok.linkedin.replace(links.linkedin, links.x), reddit: ok.reddit.replaceAll("Prompt Pantry", "Prompt Pantri"),
    }, product, links);
    expect(p.x).toMatch(/empty/);
    expect(p.facebook).toMatch(/over the 2,000 limit/);
    expect(p.linkedin).toMatch(/tracking link exactly/);
    expect(p.reddit).toMatch(/product name exactly/);
  });
});

describe("Reddit is copy-only", () => {
  it("is never sendable and no Buffer service maps to it", () => {
    expect(isSendableCampaignNetwork("reddit")).toBe(false);
    expect(isSendableCampaignNetwork("x")).toBe(true);
    expect(networkForService("reddit")).toBeNull();
  });
});
