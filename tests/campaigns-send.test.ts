// Sending approved campaign variants through the shared send service (PGlite + mocked fetch).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { sendDraftToBuffer, SEND_LIMIT_PER_DAY, type SendDeps } from "@/lib/buffer/send";
import { campaignCreativeModel, creativeModelHash } from "@/lib/campaigns/creative";
import { saveCampaignVariants } from "@/lib/campaigns/service";
import { currentHash, IMG, makeDb, NOW, saveAndApprove, seedUser, templateTexts, type Seeded } from "./campaigns-fixtures";

const { client, db, sdb, ready } = makeDb();
const CHANNELS: s.BufferChannel[] = [
  { id: "ch_test_li", name: "LI", service: "linkedin" },
  { id: "ch_test_fb", name: "FB", service: "facebook" },
  { id: "ch_test_x", name: "X", service: "twitter" },
  { id: "ch_test_reddit", name: "Reddit?", service: "reddit" },
];
let A: Seeded;
let B: Seeded;
let fetchMock: ReturnType<typeof vi.fn>;
let head: () => Response;
let n = 0;

const ok = () => new Response(JSON.stringify({ data: { createPost: { __typename: "PostActionSuccess", post: { id: `post_FAKE_${++n}`, status: "draft", dueAt: null, externalLink: null } } } }), { status: 200, headers: { "content-type": "application/json" } });
const deps = (): SendDeps => ({ db: sdb, getToken: async () => "tok_FAKE", now: () => NOW, envTestMode: undefined });
const send = (userId: string, input: Record<string, unknown>) => sendDraftToBuffer(deps(), userId, { mode: "queue", ...input });
const bufferCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("https://api.buffer.com"));
const bodyOf = (i = 0) => String((bufferCalls()[i][1] as RequestInit).body);
const inputOf = (i = 0) => JSON.parse(bodyOf(i)).variables.input;
const postsFor = (draftId: string) => db.select().from(s.bufferPosts).where(eq(s.bufferPosts.draftId, draftId));

beforeAll(async () => { await ready(); }, 30_000);
afterAll(async () => { await client.close(); });
beforeEach(async () => {
  await client.exec("truncate users cascade");
  A = await seedUser(db, "acctA", CHANNELS);
  B = await seedUser(db, "acctB", [{ id: "ch_test_b", name: "B LI", service: "linkedin" }]);
  head = () => new Response(null, { status: 200, headers: { "content-type": "image/png" } });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => (init?.method === "HEAD" ? head() : ok()));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("approval gate (before any request, token or claim)", () => {
  it("unapproved draft -> not_approved, zero fetches, no buffer_posts row, no token", async () => {
    const { texts } = await templateTexts(sdb, A.userId, A.campaignId);
    const r = await saveCampaignVariants(sdb, A.userId, { campaignId: A.campaignId, ...texts }, NOW);
    if (r.code !== "draft_saved") throw new Error();
    const getToken = vi.fn(async () => "tok_FAKE");
    const res = await sendDraftToBuffer({ ...deps(), getToken }, A.userId, { draftId: r.draftId, channelId: "ch_test_li", mode: "queue" });
    expect(res).toEqual({ code: "not_approved", lessonId: null, campaignId: A.campaignId });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
    expect(await postsFor(r.draftId)).toHaveLength(0);
  });
  it("links changed after approving (slug) -> draft_invalid, zero fetches, no claim", async () => {
    const draftId = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    await db.update(s.campaigns).set({ utmCampaign: "other-slug" }).where(eq(s.campaigns.id, A.campaignId));
    expect((await send(A.userId, { draftId, channelId: "ch_test_li" })).code).toBe("draft_invalid");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await postsFor(draftId)).toHaveLength(0);
  });
  it("a key-message change with no saved image leaves the approval valid (nothing sent changes)", async () => {
    const draftId = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    await db.update(s.campaigns).set({ keyMessage: "A different key message." }).where(eq(s.campaigns.id, A.campaignId));
    expect((await send(A.userId, { draftId, channelId: "ch_test_li" })).code).toBe("sent");
  });
  it("a draft edited after approval (approved_hash no longer matches) -> not_approved", async () => {
    const draftId = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    const { texts } = await templateTexts(sdb, A.userId, A.campaignId);
    await db.update(s.drafts).set({ perChannelText: { ...texts, reddit: texts.reddit + " edited" } }).where(eq(s.drafts.id, draftId));
    expect((await send(A.userId, { draftId, channelId: "ch_test_li" })).code).toBe("not_approved");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("approved send", () => {
  it("one request: saveToDraft true, approved text verbatim with the UTM link; approved -> queued", async () => {
    const draftId = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    const { texts, links } = await templateTexts(sdb, A.userId, A.campaignId);
    const r = await send(A.userId, { draftId, channelId: "ch_test_li" });
    expect(r).toMatchObject({ code: "sent", campaignId: A.campaignId, lessonId: null });
    expect(bufferCalls()).toHaveLength(1);
    expect(bodyOf()).toContain('"saveToDraft":true');
    expect(inputOf()).toEqual({ channelId: "ch_test_li", text: texts.linkedin, schedulingType: "automatic", mode: "addToQueue", saveToDraft: true });
    expect(inputOf().text).toContain(links.linkedin);
    expect(new URL(links.linkedin).searchParams.get("utm_source")).toBe("linkedin");
    const [d] = await db.select().from(s.drafts).where(eq(s.drafts.id, draftId));
    expect(d.status).toBe("queued");
    expect(d.approvedHash).toBe(await currentHash(sdb, db, A.userId, A.campaignId, draftId)); // kept as the record
    // queued + current approval still sends to another channel
    expect((await send(A.userId, { draftId, channelId: "ch_test_x" })).code).toBe("sent");
    expect(inputOf(1).text).toBe(texts.x);
  });
  it("Facebook keeps metadata.facebook.type = post; forged saveToDraft=false is ignored", async () => {
    const draftId = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    expect((await send(A.userId, { draftId, channelId: "ch_test_fb", saveToDraft: "false", network: "reddit", text: "forged" })).code).toBe("sent");
    expect(inputOf().metadata).toEqual({ facebook: { type: "post" } });
    expect(bodyOf()).toContain('"saveToDraft":true');
    expect(bodyOf()).not.toContain("forged");
    expect(bodyOf()).not.toContain("linkAttachment");
  });
  it("second send to the same channel -> already_sent, no second request", async () => {
    const draftId = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    await send(A.userId, { draftId, channelId: "ch_test_li" });
    expect((await send(A.userId, { draftId, channelId: "ch_test_li" })).code).toBe("already_sent");
    expect(bufferCalls()).toHaveLength(1);
  });
  it("Reddit can never reach Buffer (no channel maps to it; Reddit text is never sent)", async () => {
    const draftId = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    expect((await send(A.userId, { draftId, channelId: "ch_test_reddit", network: "reddit" })).code).toBe("not_found");
    expect(fetchMock).not.toHaveBeenCalled();
    const { texts } = await templateTexts(sdb, A.userId, A.campaignId);
    await send(A.userId, { draftId, channelId: "ch_test_x" });
    expect(bodyOf()).not.toContain(texts.reddit);
  });
  it("another user's campaign draft or channel -> not_found, no fetch", async () => {
    const draftA = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    expect((await send(B.userId, { draftId: draftA, channelId: "ch_test_b" })).code).toBe("not_found");
    expect((await send(A.userId, { draftId: draftA, channelId: "ch_test_b" })).code).toBe("not_found");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("campaign whose product isn't the user's -> not_found", async () => {
    const draftId = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    await db.update(s.campaigns).set({ productId: B.productId }).where(eq(s.campaigns.id, A.campaignId));
    expect((await send(A.userId, { draftId, channelId: "ch_test_li" })).code).toBe("not_found");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("shared daily limit", () => {
  it(`the ${SEND_LIMIT_PER_DAY + 1}st attempt in 24 h (lesson + campaign combined) -> send_limit, no fetch`, async () => {
    for (let i = 0; i < SEND_LIMIT_PER_DAY - 1; i++) {
      const [d] = await db.insert(s.drafts).values({ userId: A.userId, lessonId: A.lessonId, perChannelText: {} }).returning();
      await db.insert(s.bufferPosts).values({ draftId: d.id, channelId: "ch_test_li", service: "linkedin", bufferPostId: `post_FAKE_old_${i}`, createdAt: new Date(NOW.getTime() - 3_600_000) });
    }
    const draftId = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    expect((await send(A.userId, { draftId, channelId: "ch_test_li" })).code).toBe("sent"); // the 20th
    expect((await send(A.userId, { draftId, channelId: "ch_test_x" })).code).toBe("send_limit"); // the 21st
    expect((await send(A.userId, { draftId: A.lessonDraftId, channelId: "ch_test_fb" })).code).toBe("send_limit"); // lessons share it
    expect(bufferCalls()).toHaveLength(1);
  });
});

describe("image", () => {
  async function approvedWithImage() {
    const { texts } = await templateTexts(sdb, A.userId, A.campaignId);
    const r = await saveCampaignVariants(sdb, A.userId, { campaignId: A.campaignId, ...texts }, NOW);
    if (r.code !== "draft_saved") throw new Error();
    const [c] = await db.select().from(s.campaigns).where(eq(s.campaigns.id, A.campaignId));
    const [p] = await db.select().from(s.products).where(eq(s.products.id, A.productId));
    await db.update(s.drafts).set({ imageUrl: IMG, imageHash: creativeModelHash(campaignCreativeModel({ campaign: c, product: p })), imageSavedAt: NOW }).where(eq(s.drafts.id, r.draftId));
    const { approveCampaignDraft } = await import("@/lib/campaigns/service");
    const hash = await currentHash(sdb, db, A.userId, A.campaignId, r.draftId);
    expect((await approveCampaignDraft(sdb, A.userId, { campaignId: A.campaignId, draftId: r.draftId, hash, checkAccurate: "yes", checkLink: "yes" }, NOW)).code).toBe("approved");
    return r.draftId;
  }
  it("attached only when current, approved and attachImage=yes, HEAD-checked first", async () => {
    const draftId = await approvedWithImage();
    expect((await send(A.userId, { draftId, channelId: "ch_test_fb", attachImage: "yes" })).code).toBe("sent");
    expect(fetchMock.mock.calls[0][0]).toBe(IMG);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("HEAD");
    expect(inputOf().assets).toEqual([{ image: { url: IMG } }]);
    expect(inputOf().metadata).toEqual({ facebook: { type: "post" } });
    expect((await send(A.userId, { draftId, channelId: "ch_test_li" })).code).toBe("sent"); // no checkbox
    expect(inputOf(1)).not.toHaveProperty("assets");
  });
  it("an image saved after approval makes the approval stale -> not_approved", async () => {
    const draftId = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    const [c] = await db.select().from(s.campaigns).where(eq(s.campaigns.id, A.campaignId));
    const [p] = await db.select().from(s.products).where(eq(s.products.id, A.productId));
    await db.update(s.drafts).set({ imageUrl: IMG, imageHash: creativeModelHash(campaignCreativeModel({ campaign: c, product: p })) }).where(eq(s.drafts.id, draftId));
    expect((await send(A.userId, { draftId, channelId: "ch_test_li", attachImage: "yes" })).code).toBe("not_approved");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("HEAD failure -> image_unreachable: one fetch, no Buffer request, no claim", async () => {
    const draftId = await approvedWithImage();
    head = () => new Response(null, { status: 404 });
    expect((await send(A.userId, { draftId, channelId: "ch_test_li", attachImage: "yes" })).code).toBe("image_unreachable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await postsFor(draftId)).toHaveLength(0);
  });
});

describe("confirm another copy across campaign versions", () => {
  it("a new approved version to a channel that already has an earlier version -> confirm_another", async () => {
    const v1 = await saveAndApprove(sdb, db, A.userId, A.campaignId);
    await send(A.userId, { draftId: v1, channelId: "ch_test_li" });
    const { texts } = await templateTexts(sdb, A.userId, A.campaignId);
    const saved = await saveCampaignVariants(sdb, A.userId, { campaignId: A.campaignId, ...texts, reddit: texts.reddit + " v2" }, NOW);
    if (saved.code !== "draft_saved") throw new Error();
    expect(saved.wrote).toBe("new_version");
    const { approveCampaignDraft } = await import("@/lib/campaigns/service");
    const hash = await currentHash(sdb, db, A.userId, A.campaignId, saved.draftId);
    await approveCampaignDraft(sdb, A.userId, { campaignId: A.campaignId, draftId: saved.draftId, hash, checkAccurate: "yes", checkLink: "yes" }, NOW);
    expect((await send(A.userId, { draftId: saved.draftId, channelId: "ch_test_li" })).code).toBe("confirm_another");
    expect((await send(A.userId, { draftId: saved.draftId, channelId: "ch_test_li", confirmAnother: "yes" })).code).toBe("sent");
    expect(bufferCalls()).toHaveLength(2);
  });
});

describe("lesson sends are unchanged", () => {
  it("exact result shape and body", async () => {
    const r = await send(A.userId, { draftId: A.lessonDraftId, channelId: "ch_test_li" });
    expect(r).toEqual({ code: "sent", lessonId: A.lessonId, postId: "post_FAKE_" + n });
    expect(r).not.toHaveProperty("campaignId");
    expect(inputOf()).toEqual({ channelId: "ch_test_li", text: "Lesson LI text", schedulingType: "automatic", mode: "addToQueue", saveToDraft: true });
  });
});
