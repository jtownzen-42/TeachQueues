// Review hardening (task 04): the tracking link in a variant must be the exact final URL, not a
// longer URL that merely starts with it; and UTM links stay correct and URL-encoded.
import { describe, expect, it } from "vitest";
import { campaignDraftAll, campaignDraftProblems, containsExactLink, CAMPAIGN_NETWORKS } from "@/lib/campaigns/templates";
import { buildUtmUrl, campaignLinks } from "@/lib/campaigns/utm";

const product = { name: "Prompt Pantry", url: "https://example.com/kit?ref=a%20b#buy" };
const links = campaignLinks({ name: "Spring Kit", utmCampaign: null }, product);
const brief = { keyMessage: "Plan a week of posts in 20 minutes.", angle: "Free sample.", audience: "solo shop owners", cta: "Get the template" };

describe("containsExactLink", () => {
  const L = "https://example.com/kit?utm_source=x&utm_medium=social&utm_campaign=spring-kit";
  it.each([
    [`Go: ${L}`, true], [L, true], [`${L}\nmore`, true], [`(${L})`, true], [`See ${L}.`, true], [`See ${L}, then`, true],
    [`Go: ${L}XYZ`, false], [`Go: ${L}&ref=2`, false], [`Go: ${L}/extra`, false], [`Go: x${L}`, false], [`See ${L}.html`, false], [`nothing`, false],
  ])("%j -> %s", (text, ok) => expect(containsExactLink(text, L)).toBe(ok));
});

describe("variants must carry the exact final link", () => {
  it("templates pass; a tampered link (suffix added) is flagged for every network", () => {
    const texts = campaignDraftAll(brief, product, links);
    expect(campaignDraftProblems(texts, product, links)).toEqual({});
    for (const n of CAMPAIGN_NETWORKS) {
      const tampered = { ...texts, [n]: texts[n].replace(links[n], `${links[n]}-evil`) };
      expect(campaignDraftProblems(tampered, product, links)[n]).toMatch(/tracking link exactly/);
    }
  });
});

describe("UTM links are correct and URL-encoded", () => {
  it("keeps encoded params and the #hash; exactly one of each utm key; values decode correctly", () => {
    for (const [n, link] of Object.entries(links)) {
      const u = new URL(link);
      expect(link.startsWith("https://example.com/kit?ref=a%20b&")).toBe(true);
      expect(u.hash).toBe("#buy");
      expect(u.searchParams.get("ref")).toBe("a b");
      for (const k of ["utm_source", "utm_medium", "utm_campaign"]) expect(u.searchParams.getAll(k)).toHaveLength(1);
      expect(u.searchParams.get("utm_source")).toBe(n);
      expect(u.searchParams.get("utm_medium")).toBe("social");
      expect(u.searchParams.get("utm_campaign")).toBe("spring-kit");
      expect(link).not.toMatch(/\s/);
    }
  });
  it("percent-encoded or mixed-case existing utm keys are replaced, not duplicated", () => {
    const out = buildUtmUrl("https://example.com/kit?utm%5Fsource=old&Utm_Campaign=y&keep=1", { source: "x", medium: "social", campaign: "spring-kit" });
    expect(out).toBe("https://example.com/kit?keep=1&utm_source=x&utm_medium=social&utm_campaign=spring-kit");
  });
  it("encodes values that need it", () => {
    const out = buildUtmUrl("https://example.com/kit", { source: "x y", medium: "social&more", campaign: "a=b" });
    const u = new URL(out);
    expect(out).toContain("utm_source=x%20y");
    expect(u.searchParams.get("utm_medium")).toBe("social&more");
    expect(u.searchParams.get("utm_campaign")).toBe("a=b");
  });
});
