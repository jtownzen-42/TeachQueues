import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "@/db/url";

describe("resolveDatabaseUrl", () => {
  it("prefers DATABASE_URL", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: "a", DATABASE_POSTGRES_URL: "b" })).toBe("a");
  });
  it("accepts the DATABASE_-prefixed Neon integration names", () => {
    expect(resolveDatabaseUrl({ DATABASE_DATABASE_URL: "x" })).toBe("x");
    expect(resolveDatabaseUrl({ DATABASE_POSTGRES_URL: "y" })).toBe("y");
  });
  it("falls back to NO_SSL variant with verified TLS", () => {
    expect(resolveDatabaseUrl({ DATABASE_POSTGRES_URL_NO_SSL: "postgresql://u:p@h/db" })).toBe("postgresql://u:p@h/db?sslmode=verify-full");
  });
  it("returns undefined when nothing is set", () => {
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });
});

import { normalizeSslMode } from "@/db/url";

describe("normalizeSslMode (silences pg's sslmode alias warning)", () => {
  const neon = "postgresql://u:p@ep-x-pooler.us-east-1.aws.neon.tech/neondb";
  it("upgrades require/prefer/verify-ca to verify-full and keeps other params", () => {
    expect(normalizeSslMode(`${neon}?sslmode=require&channel_binding=require`)).toBe(`${neon}?sslmode=verify-full&channel_binding=require`);
    expect(normalizeSslMode(`${neon}?channel_binding=require&sslmode=prefer`)).toBe(`${neon}?channel_binding=require&sslmode=verify-full`);
    expect(normalizeSslMode(`${neon}?sslmode=verify-ca`)).toBe(`${neon}?sslmode=verify-full`);
  });
  it("leaves verify-full, disable, libpq-compat and param-less URLs unchanged", () => {
    for (const u of [`${neon}?sslmode=verify-full`, `${neon}?sslmode=disable`, `${neon}?uselibpqcompat=true&sslmode=require`, neon]) {
      expect(normalizeSslMode(u)).toBe(u);
    }
  });
  it("is applied by resolveDatabaseUrl", () => {
    expect(resolveDatabaseUrl({ DATABASE_POSTGRES_URL: `${neon}?sslmode=require` })).toBe(`${neon}?sslmode=verify-full`);
  });
  it("produces a config pg accepts without the SECURITY WARNING", async () => {
    const { parse } = await import("pg-connection-string");
    const warnings: string[] = [];
    const onWarn = (w: Error) => warnings.push(w.message);
    process.on("warning", onWarn);
    const cfg = parse(normalizeSslMode(`${neon}?sslmode=require`));
    await new Promise((r) => setTimeout(r, 0));
    process.off("warning", onWarn);
    expect(cfg.ssl).toBeTruthy();
    expect(warnings.filter((w) => w.includes("SECURITY WARNING"))).toEqual([]);
  });
});
