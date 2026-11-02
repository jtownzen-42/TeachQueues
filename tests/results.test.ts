// Results: money in integer cents, summary maths, validation, PGlite upsert/ownership, CSV.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";
import { centsToNumeric, formatCents, MAX_CENTS, numericToCents, parseCents } from "@/lib/results/money";
import { divRoundHalfUp, summarizeResults, type ResultRow } from "@/lib/results/summary";
import { resultInput } from "@/lib/results/validation";
import { deleteResultDay, listResultDays, saveResultDay, sentPostCount } from "@/lib/results/service";
import { csvCell, resultsCsv } from "@/lib/results/csv";

describe("money (integer cents, no floats)", () => {
  it.each([["0", 0], ["0.5", 50], ["0.05", 5], ["12.30", 1230], ["12.3", 1230], ["99999999.99", MAX_CENTS], ["$1,234.50", 123450], [" 7 ", 700]])(
    "parseCents(%j) = %i", (input, cents) => expect(parseCents(input)).toBe(cents),
  );
  it.each(["-1", "1.234", "1e3", "abc", "100000000", "", ".5", "1.", "12.30.1", "$-5", "Infinity", "0x10"])(
    "parseCents(%j) = null", (input) => expect(parseCents(input)).toBeNull(),
  );
  it("formatCents", () => {
    expect(formatCents(1230)).toBe("$12.30");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatCents(-1230)).toBe("−$12.30"); // real minus sign
    expect(formatCents(0)).toBe("$0.00");
  });
  it("numericToCents / centsToNumeric round-trip exactly", () => {
    for (const c of [0, 1, 10, 99, 100, 1230, 123456, MAX_CENTS]) expect(numericToCents(centsToNumeric(c))).toBe(c);
    expect(numericToCents("12.30")).toBe(1230);
    expect(numericToCents("12.3")).toBe(1230);
    expect(numericToCents("0")).toBe(0);
    expect(numericToCents("-5.10")).toBe(-510);
    expect(centsToNumeric(1230)).toBe("12.30");
    expect(centsToNumeric(-50)).toBe("-0.50");
    expect(() => numericToCents("12,30")).toThrow();
    // the classic float trap: 0.1 + 0.2 never happens here
    expect(parseCents("0.10")! + parseCents("0.20")!).toBe(30);
  });
});

describe("summarizeResults", () => {
  const r = (o: Partial<ResultRow>): ResultRow => ({ day: "2026-11-01", visits: 0, purchases: 0, revenue: 0, fees: 0, refunds: 0, adSpend: 0, net: 0, ...o });
  it("totals, net (may be negative), conversion and revenue per sent post", () => {
    const s1 = summarizeResults([r({ visits: 300, purchases: 7, revenue: 10000, fees: 900, refunds: 500 }), r({ day: "2026-11-02", visits: 120, purchases: 2, revenue: 2000, adSpend: 15000 })], 3);
    expect(s1.totals).toMatchObject({ visits: 420, purchases: 9, revenue: 12000, fees: 900, refunds: 500, adSpend: 15000 });
    expect(s1.net).toBe(12000 - 900 - 500 - 15000);
    expect(s1.net).toBeLessThan(0);
    expect(s1.conversion).toBe("2.1%"); // 9/420 = 2.142..%
    expect(s1.revenuePerSentPost).toBe(4000);
  });
  it("rounds half up; '—' cases are null", () => {
    expect(summarizeResults([r({ revenue: 1001 })], 2).revenuePerSentPost).toBe(501); // 500.5 -> 501
    expect(summarizeResults([r({ revenue: 1000 })], 3).revenuePerSentPost).toBe(333); // 333.33 -> 333
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(summarizeResults([r({ revenue: 1000 })], 0).revenuePerSentPost).toBeNull();
    expect(summarizeResults([r({ purchases: 3 })], 0).conversion).toBeNull();
    expect(summarizeResults([r({ visits: 8, purchases: 1 })], 0).conversion).toBe("12.5%");
    expect(summarizeResults([], 0)).toMatchObject({ net: 0, conversion: null, revenuePerSentPost: null });
  });
});

describe("resultInput", () => {
  const CID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const now = new Date("2026-11-02T15:00:00Z");
  const schema = resultInput("America/Chicago", now);
  it("parses counts and money to integer cents; blanks are 0; unknown fields stripped", () => {
    expect(schema.parse({ campaignId: CID, day: "2026-11-02", visits: "1,200", purchases: "", revenue: "$1,234.50", fees: "", refunds: "0.5", adSpend: "10", userId: "x" }))
      .toEqual({ campaignId: CID, day: "2026-11-02", visits: 1200, purchases: 0, revenue: 123450, fees: 0, refunds: 50, adSpend: 1000 });
  });
  it("rejects negatives, too many decimals, huge counts, bad and far-future days", () => {
    const bad = (o: Record<string, string>) => schema.safeParse({ campaignId: CID, day: "2026-11-02", ...o }).success;
    expect(bad({ revenue: "-1" })).toBe(false);
    expect(bad({ fees: "1.234" })).toBe(false);
    expect(bad({ visits: "10000001" })).toBe(false);
    expect(bad({ visits: "-3" })).toBe(false);
    expect(bad({ purchases: "1.5" })).toBe(false);
    expect(bad({ day: "2026-02-30" })).toBe(false);
    expect(bad({ day: "2026-11-03" })).toBe(true); // tomorrow in Chicago is allowed
    expect(bad({ day: "2026-11-04" })).toBe(false);
    expect(bad({ visits: "10000000" })).toBe(true);
  });
});

describe("results service (PGlite)", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: s });
  const sdb = db as unknown as SendDb;
  const NOW = new Date("2026-11-02T15:00:00Z");
  let A: { userId: string; campaignId: string };
  let B: { userId: string; campaignId: string };
  const seed = async (acct: string) => {
    const [u] = await db.insert(s.users).values({ bufferAccountId: acct }).returning();
    const [p] = await db.insert(s.products).values({ userId: u.id, name: "P", url: "https://example.com/kit" }).returning();
    const [c] = await db.insert(s.campaigns).values({ userId: u.id, productId: p.id, name: "Spring Kit" }).returning();
    return { userId: u.id, campaignId: c.id };
  };
  const save = (userId: string, o: Record<string, string>) => saveResultDay(sdb, userId, { day: "2026-11-01", visits: "100", purchases: "3", revenue: "12.30", fees: "1.00", refunds: "0", adSpend: "5", ...o }, "America/Chicago", NOW);

  beforeAll(async () => { await migrate(db, { migrationsFolder: "./drizzle" }); }, 30_000);
  afterAll(async () => { await client.close(); });
  beforeEach(async () => { await client.exec("truncate users cascade"); A = await seed("acctA"); B = await seed("acctB"); });

  it("saving the same day again updates it (no duplicate)", async () => {
    expect((await save(A.userId, { campaignId: A.campaignId })).code).toBe("result_saved");
    expect((await save(A.userId, { campaignId: A.campaignId, revenue: "99.99", visits: "250" })).code).toBe("result_saved");
    const rows = await db.select().from(s.results).where(eq(s.results.campaignId, A.campaignId));
    expect(rows).toHaveLength(1);
    expect([rows[0].revenue, rows[0].visits]).toEqual(["99.99", 250]);
    const days = await listResultDays(sdb, A.userId, A.campaignId);
    expect(days[0]).toMatchObject({ revenue: 9999, fees: 100, adSpend: 500, net: 9999 - 100 - 500 });
  });
  it("another user's campaign -> not_found, no write; list and delete are scoped", async () => {
    expect((await save(B.userId, { campaignId: A.campaignId })).code).toBe("not_found");
    expect(await db.select().from(s.results)).toHaveLength(0);
    await save(A.userId, { campaignId: A.campaignId });
    expect(await listResultDays(sdb, B.userId, A.campaignId)).toEqual([]);
    expect((await deleteResultDay(sdb, B.userId, { campaignId: A.campaignId, day: "2026-11-01" })).code).toBe("not_found");
    expect(await db.select().from(s.results)).toHaveLength(1);
    expect((await deleteResultDay(sdb, A.userId, { campaignId: A.campaignId, day: "2026-11-01" })).code).toBe("result_deleted");
    expect(await db.select().from(s.results)).toHaveLength(0);
  });
  it("invalid input -> result_invalid with field notes, nothing stored", async () => {
    const r = await save(A.userId, { campaignId: A.campaignId, revenue: "-5", day: "2027-01-01" });
    expect(r.code).toBe("result_invalid");
    if (r.code === "result_invalid") expect(Object.keys(r.fields).sort()).toEqual(["day", "revenue"]);
    expect(await db.select().from(s.results)).toHaveLength(0);
  });
  it("sent posts count only rows read back as sent", () => {
    expect(sentPostCount([{ post: { bufferStatus: "sent" } }, { post: { bufferStatus: "scheduled" } }, { post: { bufferStatus: null } }, { post: { bufferStatus: "sent" } }])).toBe(2);
  });
});

describe("CSV", () => {
  it("header, money in dollars, quoting, newest-first order as given", () => {
    const csv = resultsCsv([
      { day: "2026-11-02", visits: 10, purchases: 1, revenue: 1230, fees: 50, refunds: 0, adSpend: 2000, net: 1230 - 50 - 2000 },
    ]);
    expect(csv).toBe(`"day","visits","purchases","revenue","fees","refunds","ad_spend","net"\r\n"2026-11-02","10","1","12.30","0.50","0.00","20.00","-8.20"\r\n`);
  });
  it("neutralizes formula injection in text cells (not in our numeric cells)", () => {
    for (const evil of ["=HYPERLINK(\"x\")", "+1", "-1+2", "@SUM(A1)", "\tcmd", "\rcmd"]) expect(csvCell(evil).startsWith(`"'`)).toBe(true);
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("-8.20", { numeric: true })).toBe('"-8.20"');
  });
});
