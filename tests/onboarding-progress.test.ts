// "Getting started" checklist: pure progress from facts, and the facts loader on PGlite.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as s from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";
import { hasUsableChannel, onboardingProgress, type OnboardingFacts } from "@/lib/onboarding/progress";
import { loadCalendarFacts, loadOnboardingFacts } from "@/lib/onboarding/data";
import { loadSamples } from "@/lib/onboarding/samples";

const LI: s.BufferChannel = { id: "ch_test_li", name: "LI", service: "linkedin" };
const none: OnboardingFacts = { channels: null, productCount: 0, sampleProductCount: 0, lessonCount: 0, savedImageCount: 0, sentCount: 0 };
const all: OnboardingFacts = { channels: [LI], productCount: 1, sampleProductCount: 0, lessonCount: 1, savedImageCount: 1, sentCount: 1 };
const done = (f: OnboardingFacts) => Object.fromEntries(onboardingProgress(f).steps.map((st) => [st.key, st.done]));

describe("onboardingProgress", () => {
  it("brand-new user: nothing done, open, next = channel", () => {
    const p = onboardingProgress(none);
    expect(p.steps.map((st) => st.key)).toEqual(["channel", "product", "lesson", "graphic", "send"]);
    expect(p.doneCount).toBe(0);
    expect(p.total).toBe(5);
    expect(p.visibility).toBe("open");
    expect(p.next?.key).toBe("channel");
    expect(p.next?.hint).toBe("Connect an X, Facebook or LinkedIn channel in Buffer, then press Re-sync channels.");
    for (const st of p.steps) expect(st.href.startsWith("/")).toBe(true);
  });

  it("each step follows its own fact", () => {
    expect(done({ ...none, channels: [LI] })).toEqual({ channel: true, product: false, lesson: false, graphic: false, send: false });
    expect(done({ ...none, productCount: 1 })).toEqual({ channel: false, product: true, lesson: false, graphic: false, send: false });
    expect(done({ ...none, lessonCount: 2 })).toEqual({ channel: false, product: false, lesson: true, graphic: false, send: false });
    expect(done({ ...none, savedImageCount: 1 })).toEqual({ channel: false, product: false, lesson: false, graphic: true, send: false });
    expect(done({ ...none, sentCount: 3 })).toEqual({ channel: false, product: false, lesson: false, graphic: false, send: true });
  });

  it("the graphic step is labelled as saving (a preview isn't recorded)", () => {
    const g = onboardingProgress(none).steps.find((st) => st.key === "graphic")!;
    expect(g.label).toMatch(/save/i);
    expect(g.hint).toMatch(/preview alone isn't recorded/);
  });

  it("locked, disconnected and unsupported channels don't count", () => {
    expect(hasUsableChannel(null)).toBe(false);
    expect(hasUsableChannel([])).toBe(false);
    expect(hasUsableChannel([{ ...LI, isLocked: true }])).toBe(false);
    expect(hasUsableChannel([{ ...LI, isDisconnected: true }])).toBe(false);
    expect(hasUsableChannel([{ id: "ch_ig", name: "IG", service: "instagram" }, { id: "ch_rd", name: "R", service: "reddit" }])).toBe(false);
    expect(hasUsableChannel([{ ...LI, isLocked: true }, { id: "ch_x", name: "X", service: "twitter" }])).toBe(true);
    expect(hasUsableChannel([{ id: "ch_fb", name: "FB", service: "facebook" }])).toBe(true);
  });

  it("samples count for 'Add a product', flagged sampleOnly when only samples exist", () => {
    const onlySamples = onboardingProgress({ ...none, productCount: 2, sampleProductCount: 2 }).steps[1];
    expect([onlySamples.done, onlySamples.sampleOnly]).toEqual([true, true]);
    const mixed = onboardingProgress({ ...none, productCount: 3, sampleProductCount: 2 }).steps[1];
    expect([mixed.done, mixed.sampleOnly]).toEqual([true, false]);
    expect(onboardingProgress(none).steps[1].sampleOnly).toBe(false);
  });

  it("N-of-5 counting and visibility: open < 3, collapsed 3–4, hidden at 5", () => {
    const cases: [OnboardingFacts, number, string][] = [
      [none, 0, "open"],
      [{ ...none, channels: [LI] }, 1, "open"],
      [{ ...none, channels: [LI], productCount: 1 }, 2, "open"],
      [{ ...none, channels: [LI], productCount: 1, lessonCount: 1 }, 3, "collapsed"],
      [{ ...all, sentCount: 0 }, 4, "collapsed"],
      [all, 5, "hidden"],
    ];
    for (const [f, n, v] of cases) {
      const p = onboardingProgress(f);
      expect([p.doneCount, p.visibility]).toEqual([n, v]);
    }
    expect(onboardingProgress(all).next).toBeNull();
    expect(onboardingProgress({ ...all, sentCount: 0 }).next?.key).toBe("send");
  });

  it("zero products is always shown, even with other steps done", () => {
    expect(onboardingProgress({ ...all, productCount: 0 }).visibility).not.toBe("hidden");
  });
});

describe("loadOnboardingFacts / loadCalendarFacts (PGlite)", () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: s });
  const sdb = db as unknown as SendDb;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => { await migrate(db, { migrationsFolder: "./drizzle" }); }, 30_000);
  afterAll(async () => { await client.close(); });
  beforeEach(async () => {
    await client.exec("truncate users cascade");
    fetchMock = vi.fn(async () => { throw new Error("no network"); });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { expect(fetchMock).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

  it("counts only this user's real data", async () => {
    const [a] = await db.insert(s.users).values({ bufferAccountId: "acctA", channelsCache: [LI] }).returning();
    const [b] = await db.insert(s.users).values({ bufferAccountId: "acctB" }).returning();
    expect(await loadOnboardingFacts(sdb, a.id)).toEqual({ channels: [LI], productCount: 0, sampleProductCount: 0, lessonCount: 0, savedImageCount: 0, sentCount: 0 });

    await loadSamples(sdb, a.id);
    const [own] = await db.insert(s.products).values({ userId: a.id, name: "Own", url: "https://example.com/own" }).returning();
    const [l] = await db.insert(s.lessons).values({ productId: own.id, term: "t", definition: "d" }).returning();
    await db.insert(s.drafts).values({ userId: a.id, lessonId: l.id, imageUrl: "https://fake.public.blob.vercel-storage.com/x.png", imageHash: "h", imageSavedAt: new Date() });
    const [sent] = await db.insert(s.drafts).values({ userId: a.id, lessonId: l.id, status: "queued" }).returning();
    await db.insert(s.bufferPosts).values({ draftId: sent.id, channelId: "ch_test_li", service: "linkedin", bufferPostId: "post_FAKE" });
    // A failed attempt (no Buffer post id) doesn't count as sent.
    await db.insert(s.bufferPosts).values({ draftId: sent.id, channelId: "ch_test_fb", service: "facebook", bufferPostId: null });
    // Other user's data never counts.
    await loadSamples(sdb, b.id);

    expect(await loadOnboardingFacts(sdb, a.id)).toEqual({ channels: [LI], productCount: 3, sampleProductCount: 2, lessonCount: 3, savedImageCount: 1, sentCount: 1 });
    expect(await loadOnboardingFacts(sdb, b.id)).toEqual({ channels: null, productCount: 2, sampleProductCount: 2, lessonCount: 2, savedImageCount: 0, sentCount: 0 });
    expect(await loadCalendarFacts(sdb, a.id)).toEqual({ productCount: 3, draftCount: 2, sentCount: 1 });
    expect(await loadCalendarFacts(sdb, b.id)).toEqual({ productCount: 2, draftCount: 0, sentCount: 0 });
    expect(onboardingProgress(await loadOnboardingFacts(sdb, a.id)).visibility).toBe("hidden");
  });
});
