import "server-only";
// "Send to Buffer as draft": the whole send path, with db / token getter / clock injected so it
// runs against PGlite in tests. Order matters and every early exit happens before Buffer:
//   validate -> ownership (draft + channel + text) -> time -> daily limit -> token -> claim -> 1 request -> persist
import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";
import * as schema from "@/db/schema";
import { bufferPosts, drafts, users } from "@/db/schema";
import { bufferGraphQL } from "./api";
import {
  buildCreatePostInput, CREATE_POST_MUTATION, networkForService, parseCreatePostResponse, sendErrorText,
  type CreatePostResult, type SendErrorCode,
} from "./posts";
import { resolveDueAt, type DueAtError } from "./schedule";
import { draftSafe, isTestMode } from "@/lib/testmode";
import { charCount, LIMITS } from "@/lib/lessons/templates";

/** Max Buffer send attempts per user per rolling 24 hours. The app's Buffer quota is tiny and
 *  shared by everyone (and the judges), so this is deliberately low. */
export const SEND_LIMIT_PER_DAY = 20;
export const SEND_WINDOW_MS = 24 * 60 * 60_000;
/** A row left in `sending` this long (crash mid-request) counts as failed and may be retried. */
export const SENDING_STALE_MS = 10 * 60_000;
/** A failed row may be retried once per rolling 24 h, so every Buffer request is counted (see countAttempts). */
export const RETRY_WINDOW_MS = SEND_WINDOW_MS;

export const SENDING = "sending";
export const FAILED = "failed";

export type SendDb = PgDatabase<PgQueryResultHKT, typeof schema>;
export type SendDeps = {
  db: SendDb;
  getToken: (userId: string) => Promise<string>;
  now: () => Date;
  /** process.env.TEST_MODE (default ON). */
  envTestMode: string | undefined;
};

/** Unknown keys (e.g. a forged saveToDraft=false field) are stripped by zod and never read. */
export const sendInput = z.object({
  draftId: z.uuid(),
  channelId: z.string().trim().min(1).max(64),
  mode: z.enum(["queue", "custom"]),
  local: z.string().trim().max(32).optional().nullable(),
}).refine((v) => v.mode === "queue" || Boolean(v.local), { path: ["local"], message: "Pick a date and time." });
export type SendInput = z.infer<typeof sendInput>;

export type SendCode =
  | "sent" | "already_sent" | "retry_later" | "send_limit" | "not_found" | "draft_invalid"
  | DueAtError | SendErrorCode;

export type SendResult = { code: SendCode; lessonId?: string | null; retryAfter?: number; postId?: string };

const ERROR_TO_CODE: Record<SendErrorCode, SendCode> = {
  reconnect: "reconnect", busy: "busy", rejected: "rejected", buffer_error: "buffer_error", network: "network", test_mode: "test_mode",
};

/** Attempts in the window = first attempts (created_at) + retries (checked_at = last retry time).
 *  Because a row may be retried at most once per window, this counts every Buffer request exactly. */
export async function countAttempts(db: SendDb, userId: string, since: Date): Promise<number> {
  const [r] = await db.select({
    n: sql<number>`(count(*) filter (where ${bufferPosts.createdAt} > ${since}) + count(*) filter (where ${bufferPosts.checkedAt} > ${since}))::int`,
  }).from(bufferPosts).innerJoin(drafts, eq(drafts.id, bufferPosts.draftId)).where(eq(drafts.userId, userId));
  return Number(r?.n ?? 0);
}

export async function sendDraftToBuffer(deps: SendDeps, userId: string, raw: unknown): Promise<SendResult> {
  const { db } = deps;
  const parsed = sendInput.safeParse(raw);
  if (!parsed.success) {
    const timeIssue = parsed.error.issues.some((i) => i.path[0] === "local");
    return { code: timeIssue ? "time_invalid" : "not_found" };
  }
  const input = parsed.data;
  const now = deps.now();

  // --- Ownership: the draft is this user's, the channel is in this user's cache ---
  const [u] = await db.select({ tz: users.tz, testMode: users.testMode, channels: users.channelsCache })
    .from(users).where(eq(users.id, userId));
  if (!u) return { code: "not_found" };
  const [draft] = await db.select({ id: drafts.id, lessonId: drafts.lessonId, perChannelText: drafts.perChannelText })
    .from(drafts).where(and(eq(drafts.id, input.draftId), eq(drafts.userId, userId)));
  if (!draft) return { code: "not_found" };
  const lessonId = draft.lessonId;
  const channel = (u.channels ?? []).find((c) => c.id === input.channelId);
  const network = networkForService(channel?.service);
  if (!channel || !network || channel.isDisconnected || channel.isLocked) return { code: "not_found", lessonId };
  const text = typeof draft.perChannelText?.[network] === "string" ? draft.perChannelText[network].trim() : "";
  if (!text) return { code: "not_found", lessonId };
  if (charCount(text, network) > LIMITS[network]) return { code: "draft_invalid", lessonId };

  // --- Time (server recomputes UTC from the wall-clock value; client UTC is never trusted) ---
  let dueAtUtc: string | null = null;
  if (input.mode === "custom") {
    const due = resolveDueAt(input.local, u.tz, now);
    if (!due.ok) return { code: due.code, lessonId };
    dueAtUtc = due.utcIso;
  }

  // --- Already handled? Cheap pre-check so a resend doesn't burn the daily limit. ---
  const [existing] = await db.select().from(bufferPosts)
    .where(and(eq(bufferPosts.draftId, draft.id), eq(bufferPosts.channelId, channel.id)));
  if (existing && !isRetryable(existing, now)) {
    const inFlight = existing.lastStatus === SENDING && !isStale(existing, now);
    return { code: existing.bufferPostId || inFlight ? "already_sent" : "retry_later", lessonId };
  }

  // --- Per-user daily limit, before any Buffer request (token refresh included) ---
  if ((await countAttempts(db, userId, new Date(now.getTime() - SEND_WINDOW_MS))) >= SEND_LIMIT_PER_DAY) {
    return { code: "send_limit", lessonId };
  }

  // --- Token (may refresh under its own row lock). No claim yet, so nothing to undo. ---
  let token: string;
  try {
    token = await deps.getToken(userId);
  } catch (e) {
    const m = sendErrorText(e);
    if (m.code !== "reconnect") console.error("[teachqueue] send: token failed", (e as Error)?.name);
    return { code: m.code === "reconnect" ? "reconnect" : "network", lessonId };
  }

  // --- Claim the draft x channel slot atomically: at most one in-flight request ever. ---
  const claimedId = await claim(db, { draftId: draft.id, channelId: channel.id, service: channel.service, dueAtUtc, now });
  if (!claimedId) {
    const [row] = await db.select().from(bufferPosts)
      .where(and(eq(bufferPosts.draftId, draft.id), eq(bufferPosts.channelId, channel.id)));
    return { code: row && !row.bufferPostId && row.lastStatus === FAILED ? "retry_later" : "already_sent", lessonId };
  }

  // --- Exactly one Buffer request ---
  const testMode = isTestMode(deps.envTestMode, u.testMode);
  let result: CreatePostResult;
  try {
    const payload = draftSafe(buildCreatePostInput({ channelId: channel.id, text, mode: input.mode, dueAtUtc, testMode }), testMode);
    if (payload.saveToDraft !== true) throw Object.assign(new Error("not a draft"), { name: "TestModeViolation" }); // belt and braces
    result = parseCreatePostResponse(await bufferGraphQL<unknown>(token, CREATE_POST_MUTATION, { input: payload }));
  } catch (e) {
    const m = sendErrorText(e);
    console.error("[teachqueue] send: Buffer request failed", (e as { name?: string })?.name, (e as { status?: number })?.status ?? "");
    await markFailed(db, claimedId, m.text);
    return { code: ERROR_TO_CODE[m.code], lessonId, retryAfter: m.retryAfter };
  }

  if (!result.ok) {
    const m = sendErrorText(result);
    await markFailed(db, claimedId, m.text);
    return { code: "rejected", lessonId };
  }

  await db.update(bufferPosts).set({
    bufferPostId: result.postId,
    lastStatus: result.status ?? "draft",
    dueAt: result.dueAt ? new Date(result.dueAt) : dueAtUtc ? new Date(dueAtUtc) : null,
    externalLink: result.externalLink,
    error: null,
  }).where(eq(bufferPosts.id, claimedId));
  // The draft now has Buffer history: mark it queued so it can't be deleted or silently edited
  // (editing creates a new draft version; see the Lesson desk).
  await db.update(drafts).set({ status: "queued" })
    .where(and(eq(drafts.id, draft.id), eq(drafts.userId, userId), eq(drafts.status, "draft")));
  return { code: "sent", lessonId, postId: result.postId };
}

type PostRow = typeof bufferPosts.$inferSelect;

/** When the current attempt started: created_at for the first try, checked_at for a retry. */
const attemptStartedAt = (r: Pick<PostRow, "createdAt" | "checkedAt">) => r.checkedAt ?? r.createdAt;
const isStale = (r: PostRow, now: Date) =>
  r.lastStatus === SENDING && attemptStartedAt(r).getTime() < now.getTime() - SENDING_STALE_MS;

/** Retry rules: never once Buffer has a post id; failed (or stale `sending`) rows only;
 *  and at most one retry per rolling 24 h, so every attempt is counted against the limit. */
function isRetryable(r: PostRow, now: Date): boolean {
  if (r.bufferPostId) return false;
  if (!(r.lastStatus === FAILED || isStale(r, now))) return false;
  return !r.checkedAt || r.checkedAt.getTime() <= now.getTime() - RETRY_WINDOW_MS;
}

/** For the status list: "retry" (button shown), "tomorrow" (failed, already retried today),
 *  "sending" (in flight) or "done". */
export function retryState(r: PostRow, now: Date): "retry" | "tomorrow" | "sending" | "done" {
  if (r.bufferPostId) return "done";
  if (isRetryable(r, now)) return "retry";
  if (r.lastStatus === SENDING && !isStale(r, now)) return "sending";
  return "tomorrow";
}

async function claim(db: SendDb, o: { draftId: string; channelId: string; service: string; dueAtUtc: string | null; now: Date }): Promise<string | null> {
  const dueAt = o.dueAtUtc ? new Date(o.dueAtUtc) : null;
  const [fresh] = await db.insert(bufferPosts)
    .values({ draftId: o.draftId, channelId: o.channelId, service: o.service, lastStatus: SENDING, dueAt, createdAt: o.now })
    .onConflictDoNothing({ target: [bufferPosts.draftId, bufferPosts.channelId] })
    .returning({ id: bufferPosts.id });
  if (fresh) return fresh.id;
  // Retry: one conditional UPDATE, so two tabs can't both win.
  const staleBefore = new Date(o.now.getTime() - SENDING_STALE_MS);
  const retryBefore = new Date(o.now.getTime() - RETRY_WINDOW_MS);
  const [retry] = await db.update(bufferPosts)
    .set({ lastStatus: SENDING, error: null, checkedAt: o.now, dueAt, service: o.service })
    .where(and(
      eq(bufferPosts.draftId, o.draftId),
      eq(bufferPosts.channelId, o.channelId),
      sql`${bufferPosts.bufferPostId} is null`,
      sql`(${bufferPosts.lastStatus} = ${FAILED} or (${bufferPosts.lastStatus} = ${SENDING} and coalesce(${bufferPosts.checkedAt}, ${bufferPosts.createdAt}) < ${staleBefore}))`,
      sql`(${bufferPosts.checkedAt} is null or ${bufferPosts.checkedAt} <= ${retryBefore})`,
    ))
    .returning({ id: bufferPosts.id });
  return retry?.id ?? null;
}

async function markFailed(db: SendDb, id: string, text: string) {
  await db.update(bufferPosts).set({ lastStatus: FAILED, error: text, bufferPostId: null }).where(eq(bufferPosts.id, id));
}
