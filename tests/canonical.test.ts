import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { canonicalHostFrom, canonicalRedirectUrl } from "@/lib/canonical";
import { middleware } from "@/middleware";

const RU = "https://teachqueue-app.vercel.app/api/auth/callback";
const base = { pathname: "/api/auth/login", search: "?a=1&b=two", vercelEnv: "production", redirectUri: RU };

describe("canonical host", () => {
  it("derives the canonical host from BUFFER_REDIRECT_URI", () => {
    expect(canonicalHostFrom(RU)).toBe("teachqueue-app.vercel.app");
    expect(canonicalHostFrom("https://localhost:3000/api/auth/callback")).toBe("teachqueue-app.vercel.app");
    expect(canonicalHostFrom(undefined)).toBe("teachqueue-app.vercel.app");
    expect(canonicalHostFrom("not a url")).toBe("teachqueue-app.vercel.app");
  });
  it("redirects known production aliases with path + query preserved", () => {
    for (const host of ["teachqueue.vercel.app", "TEACHQUEUE-JT-TECHS.vercel.app"]) {
      expect(canonicalRedirectUrl({ ...base, host })).toBe("https://teachqueue-app.vercel.app/api/auth/login?a=1&b=two");
    }
  });
  it("leaves the canonical host, previews, per-deployment URLs and local dev alone", () => {
    expect(canonicalRedirectUrl({ ...base, host: "teachqueue-app.vercel.app" })).toBeNull();
    expect(canonicalRedirectUrl({ ...base, host: "teachqueue.vercel.app", vercelEnv: "preview" })).toBeNull();
    expect(canonicalRedirectUrl({ ...base, host: "teachqueue.vercel.app", vercelEnv: undefined })).toBeNull();
    expect(canonicalRedirectUrl({ ...base, host: "teachqueue-abc123-jt-techs.vercel.app" })).toBeNull();
    expect(canonicalRedirectUrl({ ...base, host: "localhost:3000", vercelEnv: "development" })).toBeNull();
    expect(canonicalRedirectUrl({ ...base, host: null })).toBeNull();
  });
});

describe("middleware", () => {
  it("308s an alias host in production", () => {
    const prev = { env: process.env.VERCEL_ENV, ru: process.env.BUFFER_REDIRECT_URI };
    process.env.VERCEL_ENV = "production";
    process.env.BUFFER_REDIRECT_URI = RU;
    try {
      const res = middleware(new NextRequest("https://teachqueue.vercel.app/x/y?z=1", { headers: { host: "teachqueue.vercel.app" } }));
      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe("https://teachqueue-app.vercel.app/x/y?z=1");
      const ok = middleware(new NextRequest("https://teachqueue-app.vercel.app/", { headers: { host: "teachqueue-app.vercel.app" } }));
      expect(ok.status).toBe(200);
      expect(ok.headers.get("location")).toBeNull();
    } finally {
      process.env.VERCEL_ENV = prev.env;
      process.env.BUFFER_REDIRECT_URI = prev.ru;
      if (prev.env === undefined) delete process.env.VERCEL_ENV;
      if (prev.ru === undefined) delete process.env.BUFFER_REDIRECT_URI;
    }
  });
});
