import { describe, expect, it } from "vitest";
import { approveInput, briefInput, isCalendarDate, variantsInput } from "@/lib/campaigns/validation";
import { fieldErrors } from "@/lib/lessons/validation";

const PRODUCT = "3f1b8f5e-2c4d-4a6b-9e8f-0123456789ab";
const base = {
  productId: PRODUCT, name: "Spring kit", goal: "Get 20 sign-ups to the free sample", audience: "Solo shop owners",
  angle: "Free sample with three templates", keyMessage: "Plan a week of posts in 20 minutes.", cta: "Get the template",
};
const errs = (input: unknown) => {
  const r = briefInput.safeParse(input);
  return r.success ? {} : fieldErrors(r.error);
};

describe("briefInput", () => {
  it("parses a valid brief, trims, normalises newlines, strips unknown fields", () => {
    const r = briefInput.parse({ ...base, name: "  Spring kit ", angle: "a\r\nb", kind: "ad", userId: "someone-else", saveToDraft: false });
    expect(r).toEqual({ ...base, name: "Spring kit", angle: "a\nb", startsOn: null, endsOn: null, utmCampaign: null });
    expect(r).not.toHaveProperty("kind");
    expect(r).not.toHaveProperty("userId");
  });
  it("requires every text field", () => {
    const e = errs({ productId: PRODUCT, name: " ", goal: "", audience: "", angle: "", keyMessage: "", cta: "" });
    expect(Object.keys(e).sort()).toEqual(["angle", "audience", "cta", "goal", "keyMessage", "name"]);
    expect(e.name).toMatch(/required/);
    expect(errs({ ...base, productId: "nope" }).productId).toMatch(/Pick one of your products/);
  });
  it.each([["name", 80], ["goal", 200], ["audience", 200], ["angle", 300], ["keyMessage", 280], ["cta", 60]] as const)(
    "%s max %i", (key, max) => {
      expect(briefInput.safeParse({ ...base, [key]: "x".repeat(max) }).success).toBe(true);
      expect(errs({ ...base, [key]: "x".repeat(max + 1) })[key]).toMatch(new RegExp(`${max} characters or fewer`));
    },
  );
  it("dates: real calendar dates only, optional, end >= start", () => {
    expect(briefInput.parse({ ...base, startsOn: "2026-11-01", endsOn: "2026-11-30" })).toMatchObject({ startsOn: "2026-11-01", endsOn: "2026-11-30" });
    expect(briefInput.parse({ ...base, startsOn: "", endsOn: "  " })).toMatchObject({ startsOn: null, endsOn: null });
    expect(briefInput.parse({ ...base, startsOn: "2026-11-01", endsOn: "2026-11-01" }).endsOn).toBe("2026-11-01");
    for (const bad of ["2026-02-30", "2026-13-01", "2026-11-1", "11/01/2026", "2026-11-01T00:00"]) expect(errs({ ...base, startsOn: bad }).startsOn).toMatch(/real date/);
    expect(errs({ ...base, startsOn: "2026-11-30", endsOn: "2026-11-01" }).endsOn).toMatch(/before the start/);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2027-02-29")).toBe(false);
  });
  it("utmCampaign: optional slug, blank -> null", () => {
    expect(briefInput.parse({ ...base, utmCampaign: "spring-launch-2026" }).utmCampaign).toBe("spring-launch-2026");
    expect(briefInput.parse({ ...base, utmCampaign: "   " }).utmCampaign).toBeNull();
    for (const bad of ["Spring", "spring--launch", "-spring", "spring_launch", "spring launch", "x".repeat(61)]) {
      expect(errs({ ...base, utmCampaign: bad }).utmCampaign).toBeTruthy();
    }
  });
});

describe("variantsInput / approveInput", () => {
  const CID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  it("needs all four texts and strips unknown fields", () => {
    const r = variantsInput.parse({ campaignId: CID, x: " a ", facebook: "b", linkedin: "c", reddit: "d", imageUrl: "https://evil.example" });
    expect(r).toEqual({ campaignId: CID, x: "a", facebook: "b", linkedin: "c", reddit: "d" });
    expect(variantsInput.safeParse({ campaignId: CID, x: "a", facebook: "b", linkedin: "c" }).success).toBe(false);
    expect(variantsInput.safeParse({ campaignId: "x", x: "a", facebook: "b", linkedin: "c", reddit: "d" }).success).toBe(false);
  });
  it("approve needs a 64-hex hash", () => {
    const ok = { campaignId: CID, draftId: CID, hash: "a".repeat(64), checkAccurate: "yes", checkLink: "yes" };
    expect(approveInput.safeParse(ok).success).toBe(true);
    expect(approveInput.safeParse({ ...ok, hash: "A".repeat(64) }).success).toBe(false);
    expect(approveInput.safeParse({ ...ok, hash: "abc" }).success).toBe(false);
  });
});
