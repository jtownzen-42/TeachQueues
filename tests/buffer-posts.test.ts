import { describe, expect, it } from "vitest";
import {
  buildCreatePostInput, CREATE_POST_MUTATION, networkForService, parseCreatePostResponse,
  sanitizeBufferMessage, sendErrorText,
} from "@/lib/buffer/posts";
import { draftSafe, TestModeViolation } from "@/lib/testmode";
import { BufferApiError } from "@/lib/buffer/api";
import { ReconnectRequired } from "@/lib/buffer/tokens";
import { deskNoticesFrom } from "@/lib/notices";

const FAKE_TOKEN = "tok_FAKE_abcdefghijklmnopqrstuvwxyz0123456789";

describe("draftSafe enforcement on the send path", () => {
  it("throws on saveToDraft:false in test mode; omitted/true become true", () => {
    expect(() => draftSafe({ text: "hi", saveToDraft: false }, true)).toThrow(TestModeViolation);
    expect(draftSafe({ text: "hi" }, true).saveToDraft).toBe(true);
    expect(draftSafe({ text: "hi", saveToDraft: true }, true).saveToDraft).toBe(true);
  });

  it("buildCreatePostInput always sets saveToDraft:true, with Test mode on or off", () => {
    for (const testMode of [true, false]) {
      for (const mode of ["queue", "custom"] as const) {
        const input = buildCreatePostInput({ channelId: "ch_test_1", text: "Hello", mode, dueAtUtc: "2026-11-10T15:00:00.000Z", testMode });
        expect(input.saveToDraft).toBe(true);
        expect(draftSafe(input, testMode).saveToDraft).toBe(true);
      }
    }
  });

  it("copies only known fields (extra keys from a form can't reach the payload)", () => {
    const forged = { channelId: "ch_test_1", text: "Hi", mode: "queue", testMode: false, saveToDraft: false, schedulingType: "notification" } as unknown as Parameters<typeof buildCreatePostInput>[0];
    const input = buildCreatePostInput(forged);
    expect(input).toEqual({ channelId: "ch_test_1", text: "Hi", schedulingType: "automatic", mode: "addToQueue", saveToDraft: true });
  });
});

describe("buildCreatePostInput", () => {
  it("queue mode: addToQueue and no dueAt", () => {
    const i = buildCreatePostInput({ channelId: "ch_test_1", text: "t", mode: "queue", dueAtUtc: "2026-11-10T15:00:00.000Z", testMode: true });
    expect(i.mode).toBe("addToQueue");
    expect(i).not.toHaveProperty("dueAt");
    expect(i.schedulingType).toBe("automatic");
  });
  it("custom time: customScheduled with a UTC ISO dueAt", () => {
    const i = buildCreatePostInput({ channelId: "ch_test_1", text: "t", mode: "custom", dueAtUtc: "2026-11-10T15:00:00Z", testMode: true });
    expect(i).toMatchObject({ mode: "customScheduled", dueAt: "2026-11-10T15:00:00.000Z" });
  });
  it("custom time without dueAt is a programming error", () => {
    expect(() => buildCreatePostInput({ channelId: "c", text: "t", mode: "custom", testMode: true })).toThrow();
  });
  it("mutation requests __typename and both union members", () => {
    expect(CREATE_POST_MUTATION).toMatch(/createPost\(input: \$input\)/);
    expect(CREATE_POST_MUTATION).toMatch(/__typename/);
    expect(CREATE_POST_MUTATION).toMatch(/\.\.\. on PostActionSuccess/);
    expect(CREATE_POST_MUTATION).toMatch(/\.\.\. on MutationError \{ message \}/);
  });
});

describe("parseCreatePostResponse", () => {
  it("success with __typename", () => {
    expect(parseCreatePostResponse({ createPost: { __typename: "PostActionSuccess", post: { id: "post_FAKE_1", status: "draft", dueAt: "2026-11-10T15:00:00.000Z" } } }))
      .toEqual({ ok: true, postId: "post_FAKE_1", status: "draft", dueAt: "2026-11-10T15:00:00.000Z", externalLink: null });
  });
  it("success without __typename and with a null dueAt", () => {
    expect(parseCreatePostResponse({ createPost: { post: { id: "post_FAKE_2", dueAt: null } } }))
      .toMatchObject({ ok: true, postId: "post_FAKE_2", status: null, dueAt: null });
  });
  it("MutationError", () => {
    expect(parseCreatePostResponse({ createPost: { __typename: "MutationError", message: "Text exceeds 280 characters" } }))
      .toEqual({ ok: false, message: "Text exceeds 280 characters" });
  });
  it("empty or unexpected shapes are failures", () => {
    expect(parseCreatePostResponse(null).ok).toBe(false);
    expect(parseCreatePostResponse({}).ok).toBe(false);
    expect(parseCreatePostResponse({ createPost: { __typename: "SomethingElse" } }).ok).toBe(false);
  });
});

describe("sendErrorText / sanitize (no leaks)", () => {
  const cases: [string, unknown, RegExp][] = [
    ["MutationError", { ok: false, message: "Text exceeds the 280 character limit" }, /didn't accept the post: Text exceeds the 280 character limit/],
    ["GraphQL errors", new BufferApiError(`Cannot query field "status" ${FAKE_TOKEN}`, 200), /couldn't process this request/],
    ["401", new BufferApiError("Buffer session expired. Please reconnect.", 401), /expired.*Connect again/],
    ["ReconnectRequired", new ReconnectRequired(), /expired.*Connect again/],
    ["429", new BufferApiError("busy", 429, 300), /Try again in 5 min/],
    ["network", new TypeError(`fetch failed Authorization: Bearer ${FAKE_TOKEN}`), /Couldn't reach Buffer\. Nothing was posted/],
    ["test mode", new TestModeViolation("x"), /Test mode blocked/],
  ];
  for (const [name, err, re] of cases) {
    it(`${name} -> fixed text without secrets`, () => {
      const out = sendErrorText(err);
      expect(out.text).toMatch(re);
      expect(out.text).not.toContain(FAKE_TOKEN);
      expect(out.text).not.toMatch(/bearer/i);
    });
  }
  it("keeps surrounding punctuation when redacting a bearer token", () => {
    expect(sanitizeBufferMessage("Too long (Bearer tok_FAKE_x)")).toBe("Too long ([redacted])");
  });
  it("429 carries retryAfter", () => {
    expect(sendErrorText(new BufferApiError("busy", 429, 120))).toMatchObject({ code: "busy", retryAfter: 120 });
  });
  it("strips tokens, bearer headers and query strings, and caps length", () => {
    const msg = `Denied Bearer ${FAKE_TOKEN} access_token=${FAKE_TOKEN} see https://api.buffer.com/x?token=abc&code=1 ${"long ".repeat(80)}`;
    const out = sanitizeBufferMessage(msg);
    expect(out).not.toContain(FAKE_TOKEN);
    expect(out).not.toContain("?token");
    expect(out).toContain("https://api.buffer.com/x");
    expect([...out].length).toBeLessThanOrEqual(200);
    expect(sendErrorText({ ok: false, message: msg }).text).not.toContain(FAKE_TOKEN);
  });
});

describe("networkForService", () => {
  it("maps supported services and refuses others", () => {
    expect(networkForService("twitter")).toBe("x");
    expect(networkForService("x")).toBe("x");
    expect(networkForService("facebook")).toBe("facebook");
    expect(networkForService("LinkedIn")).toBe("linkedin");
    for (const s of ["instagram", "threads", "", null, undefined]) expect(networkForService(s)).toBeNull();
  });
});

describe("send notices", () => {
  it("busy shows a clamped minute count and nothing else from the query", () => {
    expect(deskNoticesFrom({ n: "busy", wait: "5" })[0].text).toMatch(/Try again in 5 min/);
    expect(deskNoticesFrom({ n: "busy", wait: "<script>" })[0].text).not.toContain("<script>");
    expect(deskNoticesFrom({ n: "send_limit" })[0].text).toMatch(/20 posts to Buffer today/);
    expect(deskNoticesFrom({ n: "not-a-code" })).toEqual([]);
  });
});

describe("CREATE_POST_MUTATION shape (pinned to developers.buffer.com, verified 2026-11-01)", () => {
  it("uses createPost(input: CreatePostInput!) and selects both the success type and MutationError", () => {
    const q = CREATE_POST_MUTATION.replace(/\s+/g, " ");
    expect(q).toContain("($input: CreatePostInput!)");
    expect(q).toContain("createPost(input: $input)");
    expect(q).toContain("__typename");
    expect(q).toMatch(/\.\.\. on PostActionSuccess \{ post \{ id status dueAt externalLink \} \}/);
    expect(q).toMatch(/\.\.\. on MutationError \{ message \}/);
  });

  it("builds only documented CreatePostInput fields with documented enum values", () => {
    const allowed = new Set(["channelId", "text", "schedulingType", "mode", "dueAt", "saveToDraft"]);
    const q = buildCreatePostInput({ channelId: "ch_test_1", text: "Hi", mode: "queue", testMode: false });
    const c = buildCreatePostInput({ channelId: "ch_test_1", text: "Hi", mode: "custom", dueAtUtc: "2026-11-10T15:00:00.000Z", testMode: false });
    for (const i of [q, c]) {
      expect(Object.keys(i).every((k) => allowed.has(k))).toBe(true);
      expect(i.schedulingType).toBe("automatic");
      expect(i.saveToDraft).toBe(true);
    }
    expect(q.mode).toBe("addToQueue");
    expect(q).not.toHaveProperty("dueAt");
    expect(c.mode).toBe("customScheduled");
    expect(c.dueAt).toBe("2026-11-10T15:00:00.000Z");
  });
});
