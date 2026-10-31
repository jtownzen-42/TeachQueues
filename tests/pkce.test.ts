import { describe, expect, it } from "vitest";
import { codeChallengeS256, generateCodeVerifier, generateState } from "@/lib/pkce";

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B test vector", () => {
    expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
      .toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("verifier is 43 chars of the unreserved set, unique", () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    expect(generateCodeVerifier()).not.toBe(v);
    expect(generateState()).toMatch(/^[A-Za-z0-9\-_]{32}$/);
  });
});
