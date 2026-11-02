// "Delete my data" issues one DELETE on users; prove it removes every child row
// (including NO ACTION references between children) against the real migrations.
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";
import { loadSamples } from "@/lib/onboarding/samples";

describe("delete user cascade", () => {
  it("removes products (incl. samples), lessons, campaigns, drafts, buffer_posts and results", async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema: s });
    await migrate(db, { migrationsFolder: "./drizzle" });
    const [u] = await db.insert(s.users).values({ bufferAccountId: "acc1" }).returning();
    const [other] = await db.insert(s.users).values({ bufferAccountId: "acc2" }).returning();
    const [p] = await db.insert(s.products).values({ userId: u.id, name: "P", url: "https://x.test" }).returning();
    const [l] = await db.insert(s.lessons).values({ productId: p.id, term: "t", definition: "d" }).returning();
    const [c] = await db.insert(s.campaigns).values({ userId: u.id, productId: p.id, name: "C" }).returning();
    const [d] = await db.insert(s.drafts).values({ userId: u.id, lessonId: l.id, campaignId: c.id }).returning();
    await db.insert(s.bufferPosts).values({ draftId: d.id, channelId: "ch", service: "linkedin" });
    await db.insert(s.results).values({ campaignId: c.id, day: "2026-11-01" });
    await db.insert(s.products).values({ userId: other.id, name: "Q", url: "https://y.test" });
    // Sample products (and their lessons) are removed with the user too.
    expect((await loadSamples(db as unknown as SendDb, u.id)).inserted).toBe(2);

    await db.delete(s.users).where(eq(s.users.id, u.id));

    for (const t of ["products", "lessons", "campaigns", "drafts", "buffer_posts", "results"]) {
      const r = await client.query<{ n: number }>(`select count(*)::int as n from ${t}`);
      expect([t, r.rows[0].n]).toEqual([t, t === "products" ? 1 : 0]);
    }
    expect((await db.select().from(s.users)).map((x) => x.bufferAccountId)).toEqual(["acc2"]);
    await client.close();
  }, 30_000);
});
