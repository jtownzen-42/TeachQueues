import { describe, expect, it } from "vitest";
import { BUFFER_POST_STATUSES, parsePostsById, parsePostsPage, READ_BY_ID_BATCH, READ_PAGE_SIZE, READ_STATUS_QUERY, readByIdQuery, readStatusVariables } from "@/lib/buffer/read";

const TOKEN = "tok_FAKE_abcdefghijklmnopqrstuvwxyz0123456789";
const node = (over: Record<string, unknown> = {}) => ({ id: "post_test_1", channelId: "ch_test_1", status: "sent", dueAt: "2026-11-10T15:00:00Z", sentAt: "2026-11-10T15:00:05Z", externalLink: "https://www.linkedin.com/feed/update/x", error: null, ...over });
const page = (nodes: unknown[], pageInfo: unknown = { hasNextPage: false, endCursor: null }) => ({ posts: { edges: nodes.map((n) => ({ node: n })), pageInfo } });

describe("READ_STATUS_QUERY", () => {
  it("is a posts query with only the selected fields and no mutation", () => {
    expect(READ_STATUS_QUERY).toMatch(/^\s*query TeachQueuePostStatus\(/);
    expect(READ_STATUS_QUERY).toContain("posts(");
    expect(READ_STATUS_QUERY).not.toMatch(/mutation/i);
    expect(READ_STATUS_QUERY).not.toMatch(/saveToDraft|createPost/);
    expect(READ_STATUS_QUERY).toContain("edges { node { id channelId status dueAt sentAt externalLink error { message } } }");
    expect(READ_STATUS_QUERY.match(/\bnode\b/g)).toHaveLength(1);
    for (const f of ["text", "metrics", "rawError", "supportUrl"]) expect(READ_STATUS_QUERY).not.toMatch(new RegExp(`\\b${f}\\b`));
    expect(READ_STATUS_QUERY).toContain("pageInfo { hasNextPage endCursor }");
    expect(READ_STATUS_QUERY).toContain("sort: [{ field: createdAt, direction: desc }]");
  });
  it("variables: distinct sorted channel ids, every status (drafts included), ISO startDate, first 50, after only when set", () => {
    const v = readStatusVariables({ organizationId: "org_test_1", channelIds: ["ch_b", "ch_a", "ch_b"], startDate: new Date("2026-11-01T00:00:00Z") });
    expect(v).toEqual({ organizationId: "org_test_1", channelIds: ["ch_a", "ch_b"], status: ["draft", "error", "needs_approval", "scheduled", "sending", "sent"], createdAt: { start: "2026-11-01T00:00:00.000Z" }, first: READ_PAGE_SIZE });
    expect(READ_STATUS_QUERY).toContain("createdAt: $createdAt");
    expect(READ_STATUS_QUERY).not.toContain("startDate");
    expect(READ_PAGE_SIZE).toBe(50);
    expect(readStatusVariables({ organizationId: "o", channelIds: [], startDate: new Date(0), after: "cur_1" }).after).toBe("cur_1");
  });
});

describe("parsePostsPage", () => {
  it("handles all six statuses", () => {
    const r = parsePostsPage(page(BUFFER_POST_STATUSES.map((s, i) => node({ id: `p${i}`, status: s }))));
    expect(r.posts.map((p) => p.status)).toEqual(["draft", "error", "needs_approval", "scheduled", "sending", "sent"]);
  });
  it("normalises dates, keeps https links, null for missing or non-string fields", () => {
    const [p] = parsePostsPage(page([node()])).posts;
    expect(p).toEqual({ id: "post_test_1", channelId: "ch_test_1", status: "sent", dueAt: "2026-11-10T15:00:00.000Z", sentAt: "2026-11-10T15:00:05.000Z", externalLink: "https://www.linkedin.com/feed/update/x", errorMessage: null });
    const [q] = parsePostsPage(page([node({ dueAt: null, sentAt: 42, externalLink: { x: 1 }, status: "draft" })])).posts;
    expect([q.dueAt, q.sentAt, q.externalLink]).toEqual([null, null, null]);
    expect(parsePostsPage(page([node({ dueAt: "not a date" })])).posts[0].dueAt).toBeNull();
  });
  it("unknown status -> null (keep the previous one)", () => {
    expect(parsePostsPage(page([node({ status: "archived" })])).posts[0].status).toBeNull();
  });
  it("error { message } is sanitized (tokens redacted) and capped", () => {
    const [p] = parsePostsPage(page([node({ status: "error", error: { message: `Channel disconnected. Bearer ${TOKEN} ${"x ".repeat(200)}`, rawError: "internal secret" } })])).posts;
    expect(p.errorMessage).toMatch(/^Channel disconnected\./);
    expect(p.errorMessage).not.toContain(TOKEN);
    expect(p.errorMessage).not.toContain("internal secret");
    expect([...(p.errorMessage ?? "")].length).toBeLessThanOrEqual(200);
  });
  it("empty edges, hasNextPage and cursor; garbage input; edges without ids are skipped", () => {
    expect(parsePostsPage(page([]))).toEqual({ posts: [], hasNextPage: false, endCursor: null });
    expect(parsePostsPage(page([node()], { hasNextPage: true, endCursor: "cur_2" }))).toMatchObject({ hasNextPage: true, endCursor: "cur_2" });
    for (const g of [null, undefined, {}, { posts: null }, { posts: { edges: "x" } }, "nope"]) expect(parsePostsPage(g)).toEqual({ posts: [], hasNextPage: false, endCursor: null });
    expect(parsePostsPage(page([{ channelId: "c" }, { id: 5, channelId: "c" }, null])).posts).toEqual([]);
  });
});

describe("readByIdQuery / parsePostsById", () => {
  it("puts ids in variables, never in the query string, and caps the documented alias batch at 30", () => {
    const { query, variables } = readByIdQuery(["post_a", "post_b", "post_a"]);
    expect(query).toMatch(/^query TeachQueuePostById\(/);
    expect(query).toContain("p0: post(input: { id: $id0 })");
    expect(query).toContain("p1: post(input: { id: $id1 })");
    expect(query).not.toMatch(/mutation/i);
    expect(query).not.toContain("post_a");
    expect(query).not.toContain("post_b");
    expect(variables).toEqual({ id0: "post_a", id1: "post_b" });
    expect(READ_BY_ID_BATCH).toBe(30);
  });
  it("parses found posts (including unscheduled drafts) and NOT_FOUND aliases", () => {
    const ids = ["post_draft", "post_gone"];
    const data = {
      p0: { id: "post_draft", channelId: "ch_1", status: "draft", dueAt: null, sentAt: null, externalLink: null, error: null },
      p1: null,
    };
    const r = parsePostsById(data, ids, [{ message: "Resource doesn't exist", path: ["p1"], extensions: { code: "NOT_FOUND" } }]);
    expect(r.fatal).toBe(false);
    expect(r.notFound).toEqual(["post_gone"]);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]).toMatchObject({ id: "post_draft", status: "draft", dueAt: null });
  });
  it("a non-NOT_FOUND field error is fatal and is not treated as missing", () => {
    const r = parsePostsById({ p0: null }, ["post_x"], [{ message: "boom", path: ["p0"], extensions: { code: "UNEXPECTED" } }]);
    expect(r.fatal).toBe(true);
    expect(r.notFound).toEqual([]);
    expect(r.posts).toEqual([]);
  });
});
