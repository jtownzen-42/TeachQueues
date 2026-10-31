import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl } from "@/lib/buffer/oauth";
import { parseRateLimit } from "@/lib/buffer/api";

describe("authorize URL", () => {
  it("includes PKCE S256, state, consent prompt and exact redirect", () => {
    const u = new URL(buildAuthorizeUrl({
      clientId: "cid", redirectUri: "https://localhost:3000/api/auth/callback",
      scope: "account:read posts:read posts:write offline_access", state: "st", codeChallenge: "ch",
    }));
    expect(u.origin + u.pathname).toBe("https://auth.buffer.com/auth");
    expect(u.searchParams.get("redirect_uri")).toBe("https://localhost:3000/api/auth/callback");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBe("ch");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("scope")).toContain("offline_access");
  });
});

describe("rate limit headers", () => {
  it("parses RateLimit structured header", () => {
    const h = new Headers({ RateLimit: "limit=100, remaining=97, reset=812" });
    expect(parseRateLimit(h)).toMatchObject({ limit: 100, remaining: 97, resetSeconds: 812 });
  });
});
