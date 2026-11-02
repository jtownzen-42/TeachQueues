// Landing / How it works copy: exact headline, and no invented claims or banned words.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LANDING } from "@/lib/onboarding/landing";

const all = JSON.stringify(LANDING);
const howItWorks = readFileSync("src/app/how-it-works/page.tsx", "utf8");

describe("landing copy", () => {
  it("has the exact headline, sign-in label and footer", () => {
    expect(LANDING.headline).toBe("Teach what you sell. Queue it in Buffer.");
    expect(LANDING.product).toBe("TeachQueue");
    expect(LANDING.signIn).toBe("Sign in with Buffer");
    expect(LANDING.footer).toBe("TeachQueue is a #BufferCommit entry.");
    expect(LANDING.steps.map((s) => s.title)).toEqual(["Add a product and a few lessons", "Review the exact posts and graphic", "Send to Buffer"]);
    expect(LANDING.testMode).toBe("Test mode is on for every new account. Everything TeachQueue sends to Buffer is saved as a draft, so nothing is published from TeachQueue. You review, schedule and publish inside Buffer.");
    expect(LANDING.expiredLead).toBe("Your Buffer connection has expired or was revoked. Sign in again to continue.");
  });

  it("makes no invented claims and avoids banned words", () => {
    for (const text of [all, howItWorks]) {
      const lower = text.toLowerCase();
      for (const w of ["proof", "insurance", "testimonial", "alexx", "trusted by", "users love"]) expect(lower).not.toContain(w);
      for (const re of [/\bforge\b/, /\bstele\b/, /\brated\b/, /\bstars?\b/]) expect(lower).not.toMatch(re);
      expect(text).not.toMatch(/\d+\s*%/);
    }
    // No digits used as stats in the copy constants at all.
    expect(all).not.toMatch(/\d/);
  });

  it("/how-it-works is static: no session, database or Buffer access", () => {
    for (const w of ["getDb", "requireUserId", "getAppSession", "@/lib/buffer", "fetch("]) expect(howItWorks).not.toContain(w);
    expect(howItWorks).toContain('href="/privacy"');
  });
});
