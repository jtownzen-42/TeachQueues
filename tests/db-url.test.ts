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
  it("falls back to NO_SSL variant with sslmode=require", () => {
    expect(resolveDatabaseUrl({ DATABASE_POSTGRES_URL_NO_SSL: "postgresql://u:p@h/db" })).toBe("postgresql://u:p@h/db?sslmode=require");
  });
  it("returns undefined when nothing is set", () => {
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });
});
