// Campaign creative: model, hash, three sizes (real PNGs via next/og), and the route guard.
// Set CREATIVE_PREVIEW_DIR to also write the PNGs for a visual check.
import { describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  campaignCreativeModel, creativeAltText, creativeModelHash, CREATIVE_LIMITS, CREATIVE_SIZES, CREATIVE_SIZE_KEYS, isCreativeSize,
} from "@/lib/campaigns/creative";
import { creativeSteps, renderCampaignCreative, renderCampaignCreativePng } from "@/lib/campaigns/render";
import { creativeGuard } from "@/lib/campaigns/guard";
import { FALLBACK_ACCENT } from "@/lib/graphics/card";

const words = (n: number, w = "word") => Array.from({ length: n }, (_, i) => `${w}${i % 9}`).join(" ");
const campaign = { keyMessage: "Plan a week of posts in 20 minutes.", angle: "Free sample kit with three ready-made templates.", cta: "Get the kit", name: "Spring kit", utmCampaign: null };
const product = { name: "Prompt Pantry", brandColors: ["#2563eb"] };
const longModel = campaignCreativeModel({
  campaign: { keyMessage: words(40, "Headline"), angle: words(60, "angle"), cta: words(12, "Callto") },
  product: { name: words(10, "Productname"), brandColors: ["#fde047"] },
});
const wideModel = campaignCreativeModel({
  campaign: { keyMessage: "W".repeat(120), angle: "M".repeat(200), cta: "W".repeat(60) },
  product: { name: "M".repeat(60), brandColors: null },
});

function pngSize(buf: Uint8Array) {
  expect([...buf.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  const dv = new DataView(buf.buffer, buf.byteOffset);
  return [dv.getUint32(16), dv.getUint32(20)];
}

describe("campaignCreativeModel", () => {
  it("draws the brief and product with the mark", () => {
    expect(campaignCreativeModel({ campaign, product })).toEqual({
      headline: campaign.keyMessage, sub: campaign.angle, cta: "Get the kit", productName: "Prompt Pantry",
      accent: "#2563eb", onAccent: "#ffffff", mark: "Alexx Forge",
    });
  });
  it("truncates every field to its limit on word boundaries", () => {
    expect([...longModel.headline].length).toBeLessThanOrEqual(CREATIVE_LIMITS.headline);
    expect([...longModel.sub].length).toBeLessThanOrEqual(CREATIVE_LIMITS.sub);
    expect([...longModel.cta].length).toBeLessThanOrEqual(CREATIVE_LIMITS.cta);
    expect([...longModel.productName].length).toBeLessThanOrEqual(CREATIVE_LIMITS.product);
    expect(longModel.headline.endsWith("…")).toBe(true);
    expect(wideModel.accent).toBe(FALLBACK_ACCENT);
  });
  it("hash is stable for equal input and changes with the key message", () => {
    const a = creativeModelHash(campaignCreativeModel({ campaign, product }));
    expect(creativeModelHash(campaignCreativeModel({ campaign: { ...campaign }, product: { ...product } }))).toBe(a);
    expect(creativeModelHash(campaignCreativeModel({ campaign: { ...campaign, keyMessage: "Different" }, product }))).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("sizes and alt text", () => {
    expect(CREATIVE_SIZES).toEqual({ square: [1080, 1080], landscape: [1200, 628], story: [1080, 1920] });
    expect(isCreativeSize("story")).toBe(true);
    for (const bad of ["huge", "toString", "__proto__", "", null]) expect(isCreativeSize(bad)).toBe(false);
    expect(creativeAltText(campaignCreativeModel({ campaign, product }), "landscape")).toBe("Campaign creative (1200×628): Plan a week of posts in 20 minutes. — Get the kit for Prompt Pantry");
  });
  it("longest text uses the smallest font steps", () => {
    expect(creativeSteps(longModel, "square")).toMatchObject({ headline: 54, sub: 32 });
    expect(creativeSteps(longModel, "landscape")).toMatchObject({ headline: 40, sub: 24 });
    expect(creativeSteps(longModel, "story")).toMatchObject({ headline: 72, sub: 42 });
  });
});

describe("renderCampaignCreative", () => {
  const short = campaignCreativeModel({ campaign, product });
  for (const size of CREATIVE_SIZE_KEYS) {
    for (const [name, model] of [["short", short], ["long", longModel], ["wide", wideModel]] as const) {
      it(`${size} / ${name}: PNG at ${CREATIVE_SIZES[size].join("x")}`, async () => {
        const png = new Uint8Array(await renderCampaignCreativePng(model, size));
        expect(pngSize(png)).toEqual([...CREATIVE_SIZES[size]]);
        const dir = process.env.CREATIVE_PREVIEW_DIR;
        if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `${size}-${name}.png`), png); }
      }, 30_000);
    }
  }
  it("passes route headers through", async () => {
    const res = renderCampaignCreative(short, "square", { "Cache-Control": "private, no-store", "Content-Type": "image/png" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    await res.arrayBuffer();
  }, 30_000);
});

describe("creativeGuard (route)", () => {
  const ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const row = { campaign, product };
  it("signed out -> 401 without a query", async () => {
    const load = vi.fn();
    expect(await creativeGuard({ getUserId: async () => null, loadCampaign: load }, ID, "square")).toEqual({ status: 401 });
    expect(load).not.toHaveBeenCalled();
  });
  it("other user's / unknown campaign -> 404; bad id -> 404 without a query", async () => {
    expect(await creativeGuard({ getUserId: async () => "u2", loadCampaign: async () => null }, ID, "square")).toEqual({ status: 404 });
    const load = vi.fn();
    expect(await creativeGuard({ getUserId: async () => "u1", loadCampaign: load }, "nope", "square")).toEqual({ status: 404 });
    expect(load).not.toHaveBeenCalled();
  });
  it("campaign without a product -> 404", async () => {
    expect(await creativeGuard({ getUserId: async () => "u1", loadCampaign: async () => ({ campaign, product: null }) }, ID, "square")).toEqual({ status: 404 });
  });
  it("bad size -> 400 (owner only)", async () => {
    for (const s of ["huge", null, "__proto__"]) {
      expect(await creativeGuard({ getUserId: async () => "u1", loadCampaign: async () => row }, ID, s)).toEqual({ status: 400 });
    }
  });
  it("owner -> 200 with model, size, hash and a safe filename", async () => {
    const g = await creativeGuard({ getUserId: async () => "u1", loadCampaign: async () => ({ campaign: { ...campaign, name: "Spring Kit: 20% off!", utmCampaign: null }, product }) }, ID, "story");
    expect(g).toMatchObject({ status: 200, size: "story", filename: "teachqueue-spring-kit-20-off-story.png" });
    if (g.status === 200) expect(g.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
