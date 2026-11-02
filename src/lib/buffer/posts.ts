// ============================================================================================
// VERIFY AGAINST LIVE BUFFER SCHEMA — Martha will check this mutation against Buffer's live API before enabling.
//
// VERIFIED 2026-11-01 against Buffer's public API docs (no live createPost call was made):
//   https://developers.buffer.com/reference.md                     (createPost(input: CreatePostInput!): PostActionPayload!)
//   https://developers.buffer.com/types/CreatePostInput.html       (channelId: ChannelId!, text: String, schedulingType: SchedulingType!,
//                                                                    mode: ShareMode!, dueAt: DateTime, saveToDraft: Boolean;
//                                                                    assets defaults to [], needsApproval defaults to false)
//   https://developers.buffer.com/examples/create-draft-post.html  (saveToDraft: true -> post status 'draft', never published)
//   https://developers.buffer.com/guides/posts-and-scheduling.html (addToQueue; customScheduled + dueAt ISO 8601 UTC)
//   https://developers.buffer.com/guides/error-handling.md         (MutationError is an interface implemented by every
//                                                                    PostActionPayload error member; auth/rate errors come in `errors`)
//   Enums: SchedulingType { automatic notification }, ShareMode { addToQueue customScheduled shareNext shareNow },
//          PostStatus { draft error needs_approval scheduled sending sent }. Post has id, status, dueAt, externalLink.
// The operation below was validated with graphql-js against an SDL transcribed from those pages, and both payloads
// built by buildCreatePostInput() coerce cleanly as CreatePostInput variables.
//
// Everything Buffer-schema-specific for creating posts lives in this one file:
//   CREATE_POST_MUTATION, buildCreatePostInput(), parseCreatePostResponse(), networkForService().
// Pure module (no server-only imports) so it is unit-testable.
// ============================================================================================
import type { Network } from "@/lib/lessons/templates";

export const CREATE_POST_MUTATION = /* GraphQL */ `
  mutation TeachQueueCreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id status dueAt externalLink } }
      ... on MutationError { message }
    }
  }
`;

export type SendMode = "queue" | "custom";

export type CreatePostInput = {
  channelId: string;
  text: string;
  schedulingType: "automatic";
  mode: "addToQueue" | "customScheduled";
  dueAt?: string;
  saveToDraft: true;
};

/** Build the createPost input. This task never posts for real, so saveToDraft is always true
 *  here, and the caller still runs draftSafe() on the result as the last step before sending.
 *  Only the listed fields are copied: nothing from a form can reach the payload. */
export function buildCreatePostInput(opts: {
  channelId: string; text: string; mode: SendMode; dueAtUtc?: string | null; testMode: boolean;
}): CreatePostInput {
  const input: CreatePostInput = {
    channelId: opts.channelId,
    text: opts.text,
    schedulingType: "automatic",
    mode: opts.mode === "custom" ? "customScheduled" : "addToQueue",
    saveToDraft: true, // drafts only, whether Test mode is on or off
  };
  if (opts.mode === "custom") {
    if (!opts.dueAtUtc) throw new Error("dueAtUtc is required for a custom time");
    input.dueAt = new Date(opts.dueAtUtc).toISOString();
  }
  return input;
}

export type CreatePostResult =
  | { ok: true; postId: string; status: string | null; dueAt: string | null; externalLink: string | null }
  | { ok: false; message: string };

type Raw = {
  createPost?: {
    __typename?: string;
    post?: { id?: unknown; status?: unknown; dueAt?: unknown; externalLink?: unknown } | null;
    message?: unknown;
  } | null;
} | null | undefined;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/** Parse the createPost payload, tolerating the union __typename (or its absence). */
export function parseCreatePostResponse(data: unknown): CreatePostResult {
  const cp = (data as Raw)?.createPost;
  if (!cp) return { ok: false, message: "Buffer returned an empty response." };
  const postId = str(cp.post?.id);
  if (postId && (cp.__typename === undefined || cp.__typename === "PostActionSuccess")) {
    return { ok: true, postId, status: str(cp.post?.status), dueAt: str(cp.post?.dueAt), externalLink: str(cp.post?.externalLink) };
  }
  return { ok: false, message: str(cp.message) ?? "Buffer didn't accept the post." };
}

/** Buffer `service` -> our network key. Anything else isn't offered. */
export function networkForService(service: string | null | undefined): Network | null {
  switch ((service ?? "").trim().toLowerCase()) {
    case "twitter":
    case "x":
      return "x";
    case "facebook":
      return "facebook";
    case "linkedin":
      return "linkedin";
    default:
      return null;
  }
}

// ---------- Error mapping (fixed, plain-English text; never raw upstream bodies) ----------

export type SendErrorCode = "reconnect" | "busy" | "rejected" | "buffer_error" | "network" | "test_mode";
export type SendError = { code: SendErrorCode; text: string; retryAfter?: number };

/** Strip anything that looks like a credential, URL query string or long opaque id, and cap length. */
export function sanitizeBufferMessage(msg: string): string {
  const cleaned = msg
    .replace(/bearer\s+[^\s,;)\]}"']+/gi, "[redacted]")
    .replace(/\b(authorization|access_token|refresh_token|token|code|client_secret|secret|api[_-]?key)\b\s*[:=]\s*[^\s,;&]+/gi, "$1=[redacted]")
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, "$1")
    .replace(/[A-Za-z0-9_\-+/=.]{32,}/g, "[redacted]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const capped = [...cleaned].length > 200 ? [...cleaned].slice(0, 199).join("").trimEnd() + "…" : cleaned;
  return capped || "Buffer didn't accept the post.";
}

export const minutesText = (seconds: number) => {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return `${m} min`;
};

export const SEND_ERROR_TEXT = {
  reconnect: "Your Buffer connection has expired. Connect again, then retry. Nothing was posted.",
  network: "Couldn't reach Buffer. Nothing was posted. Try again shortly.",
  buffer_error: "Buffer couldn't process this request. Nothing was posted. Try again later.",
  test_mode: "Test mode blocked this send because it wasn't a draft. Nothing was posted.",
} as const;

/** Map anything thrown or returned during a send to fixed text. `e` may be a parsed
 *  MutationError ({ ok: false, message }), a BufferApiError-like object, or anything else. */
export function sendErrorText(e: unknown): SendError {
  const err = e as { name?: unknown; status?: unknown; retryAfter?: unknown; ok?: unknown; message?: unknown };
  if (err && err.ok === false && typeof err.message === "string") {
    return { code: "rejected", text: `Buffer didn't accept the post: ${sanitizeBufferMessage(err.message)}` };
  }
  if (err?.name === "ReconnectRequired" || err?.status === 401) return { code: "reconnect", text: SEND_ERROR_TEXT.reconnect };
  if (err?.name === "TestModeViolation") return { code: "test_mode", text: SEND_ERROR_TEXT.test_mode };
  if (err?.status === 429) {
    const ra = typeof err.retryAfter === "number" && Number.isFinite(err.retryAfter) ? Math.max(0, err.retryAfter) : 60;
    return { code: "busy", retryAfter: ra, text: `Buffer is busy right now. Nothing was posted. Try again in ${minutesText(ra)}.` };
  }
  if (err?.name === "BufferApiError") return { code: "buffer_error", text: SEND_ERROR_TEXT.buffer_error };
  return { code: "network", text: SEND_ERROR_TEXT.network };
}
