import { describe, expect, it } from "vitest";
import { buildUtmUrl, campaignLinks, campaignSlug, slugify, UTM_MEDIUM, UTM_SOURCE } from "@/lib/campaigns/utm";

const utm = { source: "x", medium: "social", campaign: "spring-kit" };

describe("slugify", () => {
  it.each([
    ["Spring Kit", "spring-kit"],
    ["Café Crème — Été 2026!", "cafe-creme-ete-2026"],
    ["  --Hello,   World!!--  ", "hello-world"],
    ["Ünïcödé Ñame", "unicode-name"],
    ["", "campaign"],
    ["!!!", "campaign"],
    ["日本語", "campaign"],
  ])("%j -> %j", (input, out) => expect(slugify(input)).toBe(out));
  it("max 60, cut on a dash", () => {
    const s = slugify("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron");
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect("alpha-beta-gamma-delta-epsilon-zeta-eta-theta-iota-kappa-lambda-mu".startsWith(s)).toBe(true);
    expect(slugify("x".repeat(100))).toBe("x".repeat(60));
  });
  it("campaignSlug prefers a valid saved slug", () => {
    expect(campaignSlug({ name: "Spring Kit", utmCampaign: "launch-1" })).toBe("launch-1");
    expect(campaignSlug({ name: "Spring Kit", utmCampaign: null })).toBe("spring-kit");
    expect(campaignSlug({ name: "Spring Kit", utmCampaign: "Bad Slug" })).toBe("spring-kit");
  });
});

describe("buildUtmUrl", () => {
  it("adds the three params", () => {
    expect(buildUtmUrl("https://example.com/kit", utm)).toBe("https://example.com/kit?utm_source=x&utm_medium=social&utm_campaign=spring-kit");
  });
  it("keeps path, other query params (order and encoding) and #hash", () => {
    expect(buildUtmUrl("https://example.com/shop/kit?ref=abc&q=a%20b&flag#buy", utm))
      .toBe("https://example.com/shop/kit?ref=abc&q=a%20b&flag&utm_source=x&utm_medium=social&utm_campaign=spring-kit#buy");
  });
  it("replaces existing utm_source/medium/campaign instead of duplicating", () => {
    const out = buildUtmUrl("https://example.com/kit?utm_source=old&a=1&UTM_MEDIUM=email&utm_campaign=x&utm_campaign=y&utm_content=keep", utm);
    const u = new URL(out);
    expect(u.searchParams.getAll("utm_source")).toEqual(["x"]);
    expect(u.searchParams.getAll("utm_campaign")).toEqual(["spring-kit"]);
    expect(out).not.toMatch(/UTM_MEDIUM|old|email/);
    expect(u.searchParams.get("utm_content")).toBe("keep");
    expect(u.searchParams.get("a")).toBe("1");
  });
  it("https only, and <= 2,048 chars", () => {
    expect(() => buildUtmUrl("http://example.com/kit", utm)).toThrow();
    expect(() => buildUtmUrl(`https://example.com/${"a".repeat(2050)}`, utm)).toThrow(/too long/);
  });
});

describe("campaignLinks", () => {
  it("one link per network with the right utm_source, medium=social and the slug", () => {
    const links = campaignLinks({ name: "Spring Kit", utmCampaign: null }, { url: "https://example.com/kit?ref=1" });
    expect(Object.keys(links)).toEqual(["x", "facebook", "linkedin", "reddit"]);
    for (const [n, link] of Object.entries(links)) {
      const u = new URL(link);
      expect(u.searchParams.get("utm_source")).toBe(UTM_SOURCE[n as keyof typeof UTM_SOURCE]);
      expect(u.searchParams.get("utm_medium")).toBe(UTM_MEDIUM);
      expect(u.searchParams.get("utm_campaign")).toBe("spring-kit");
      expect(u.searchParams.get("ref")).toBe("1");
    }
    expect(UTM_MEDIUM).toBe("social");
  });
});
