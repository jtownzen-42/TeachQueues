import "server-only";
// On-demand, read-only status read-back from Buffer for the Calendar. Never a mutation, never polling.
// Order: inputs -> cooldown / auto-age -> rate-limit guard -> stamp attempt -> token -> <= MAX_READ_PAGES
// queries -> write results (cache columns only) -> stamp success.
import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { bufferPosts, bufferRateLimits, drafts, users } from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";
import { bufferGraphQLWithMeta } from "@/lib/buffer/api";
import { parsePostsPage, READ_STATUS_QUERY, readStatusVariables, type ReadPost } from "@/lib/buffer/read";
import { rateLimitState, type RateLimitWindow } from "@/lib/buffer/ratelimit";

/** Opening /calendar reads Buffer only when the last successful read is older than this. */
export const AUTO_READ_AFTER_MS = 10 * 60_000;
/** "Refresh from Buffer" at most once per minute per user (failed attempts count). */
export const REFRESH_COOLDOWN_MS = 60_000;
/** Max Buffer requests per read-back (including one short 429 retry). */
export const MAX_READ_PAGES = 3;
/** A 429 with Retry-After at or below this is waited out once; longer means "busy". */
export const SHORT_RETRY_MAX_S = 5;
/** buffer_rate_limits.window_seconds used to remember "busy until" after a 429. */
export const BUSY_MARKER_WINDOW = 0;

export type ReadTrigger = "auto" | "manual";
export type ReadCode =
  | "read_ok" | "read_partial" | "nothing_to_read" | "refresh_cooldown" | "quota_low" | "busy" | "reconnect" | "read_failed"
  /** auto only: last read is recent enough, nothing done (no notice). */
  | "not_due";
export type ReadResult = { code: ReadCode; retryAfter?: number; requests: number; matched?: number; missing?: number };

type GraphQL = <T>(token: string, query: string, variables?: Record<string, unknown>) => Promise<{ data: T; windows: RateLimitWindow[] }>;
export type ReadDeps = {
  db: SendDb;
  getToken: (userId: string) => Promise<string>;
  now: () => Date;
  /** Defaults to the existing client (bufferGraphQLWithMeta). */
  graphql?: GraphQL;
  sleep?: (ms: number) => Promise<void>;
};

type SentRow = { id: string; bufferPostId: string; channelId: string; createdAt: Date };

/** This user's buffer_posts rows that have a Buffer post id (joined through drafts.user_id). */
export async function sentRowsFor(db: SendDb, userId: string): Promise<SentRow[]> {
  const rows = await db.select({ id: bufferPosts.id, bufferPostId: bufferPosts.bufferPostId, channelId: bufferPosts.channelId, createdAt: bufferPosts.createdAt })
    .from(bufferPosts).innerJoin(drafts, eq(drafts.id, bufferPosts.draftId))
    .where(and(eq(drafts.userId, userId), isNotNull(bufferPosts.bufferPostId)));
  return rows.filter((r): r is SentRow => typeof r.bufferPostId === "string");
}

export async function loadRateLimits(db: SendDb) {
  return db.select().from(bufferRateLimits);
}

/** Upsert the app-wide windows from one response. */
export async function recordWindows(db: SendDb, windows: RateLimitWindow[], now: Date) {
  for (const w of windows) {
    if (!w.w || w.w <= 0) continue;
    const values = {
      windowSeconds: w.w, quota: w.q ?? null, remaining: w.r ?? null,
      resetAt: w.t !== undefined ? new Date(now.getTime() + w.t * 1000) : null, busyUntil: null, updatedAt: now,
    };
    await db.insert(bufferRateLimits).values(values)
      .onConflictDoUpdate({ target: bufferRateLimits.windowSeconds, set: { quota: values.quota, remaining: values.remaining, resetAt: values.resetAt, busyUntil: null, updatedAt: now } });
  }
}

async function recordBusy(db: SendDb, until: Date | null, now: Date) {
  await db.insert(bufferRateLimits).values({ windowSeconds: BUSY_MARKER_WINDOW, busyUntil: until, updatedAt: now })
    .onConflictDoUpdate({ target: bufferRateLimits.windowSeconds, set: { busyUntil: until, updatedAt: now } });
}

/** UPDATE scoped by the row id AND a subquery proving its draft belongs to the user. */
const ownedRow = (db: SendDb, userId: string, rowId: string) => and(
  eq(bufferPosts.id, rowId),
  inArray(bufferPosts.draftId, db.select({ id: drafts.id }).from(drafts).where(eq(drafts.userId, userId))),
);

async function writeSeen(db: SendDb, userId: string, rowId: string, p: ReadPost, now: Date) {
  // Cache columns only. Never checked_at / created_at (send attempt count + retry rules) or
  // last_status / error / buffer_post_id (send claim state).
  const set: Partial<typeof bufferPosts.$inferInsert> = {
    bufferError: p.errorMessage, bufferSyncedAt: now, bufferMissingAt: null,
    ...(p.status ? { bufferStatus: p.status } : {}),
    ...(p.dueAt ? { dueAt: new Date(p.dueAt) } : {}),
    ...(p.sentAt ? { sentAt: new Date(p.sentAt) } : {}),
    ...(p.externalLink ? { externalLink: p.externalLink } : {}),
  };
  await db.update(bufferPosts).set(set).where(ownedRow(db, userId, rowId));
}

async function writeMissing(db: SendDb, userId: string, rowId: string, now: Date) {
  await db.update(bufferPosts).set({ bufferMissingAt: now, bufferSyncedAt: now }).where(ownedRow(db, userId, rowId));
}

const isApiError = (e: unknown): e is { name: string; status: number; retryAfter?: number; windows?: RateLimitWindow[] } =>
  (e as { name?: string })?.name === "BufferApiError";

export async function readBackStatuses(deps: ReadDeps, userId: string, opts: { trigger: ReadTrigger }): Promise<ReadResult> {
  const { db } = deps;
  const graphql: GraphQL = deps.graphql ?? bufferGraphQLWithMeta;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now();

  // --- Inputs: something to read, an organization, a token ---
  const [u] = await db.select({
    orgId: users.orgId, hasToken: sql<boolean>`${users.accessTokenEnc} is not null`,
    readAt: users.postsReadAt, attemptAt: users.postsReadAttemptAt,
  }).from(users).where(eq(users.id, userId));
  if (!u) return { code: "nothing_to_read", requests: 0 };
  const rows = await sentRowsFor(db, userId);
  if (rows.length === 0 || !u.orgId) return { code: "nothing_to_read", requests: 0 };
  if (!u.hasToken) return { code: "reconnect", requests: 0 };

  // --- Cooldown (manual) / age (auto) ---
  const sinceAttempt = u.attemptAt ? now.getTime() - u.attemptAt.getTime() : Infinity;
  if (opts.trigger === "manual" && sinceAttempt < REFRESH_COOLDOWN_MS) return { code: "refresh_cooldown", requests: 0 };
  if (opts.trigger === "auto") {
    const sinceRead = u.readAt ? now.getTime() - u.readAt.getTime() : Infinity;
    if (sinceRead < AUTO_READ_AFTER_MS || sinceAttempt < REFRESH_COOLDOWN_MS) return { code: "not_due", requests: 0 };
  }

  // --- App-wide rate-limit guard ---
  const guard = rateLimitState(await loadRateLimits(db), now);
  if (guard.busyUntil) return { code: "busy", retryAfter: Math.ceil((guard.busyUntil.getTime() - now.getTime()) / 1000), requests: 0 };
  if (guard.low) return { code: "quota_low", requests: 0 };

  // From here on it's an attempt (drives the 60 s cooldown even if it fails). Claimed atomically:
  // the conditional UPDATE re-checks the cooldown (and, for auto, the 10-minute age) in the database,
  // so two concurrent refreshes or page loads can't both pass the check above and both call Buffer.
  const claimConds = [
    eq(users.id, userId),
    or(isNull(users.postsReadAttemptAt), lte(users.postsReadAttemptAt, new Date(now.getTime() - REFRESH_COOLDOWN_MS))),
  ];
  if (opts.trigger === "auto") {
    claimConds.push(or(isNull(users.postsReadAt), lte(users.postsReadAt, new Date(now.getTime() - AUTO_READ_AFTER_MS))));
  }
  const claimed = await db.update(users).set({ postsReadAttemptAt: now }).where(and(...claimConds)).returning({ id: users.id });
  if (claimed.length === 0) return { code: opts.trigger === "manual" ? "refresh_cooldown" : "not_due", requests: 0 };

  let token: string;
  try {
    token = await deps.getToken(userId);
  } catch (e) {
    if ((e as Error)?.name === "ReconnectRequired" || (isApiError(e) && e.status === 401)) return { code: "reconnect", requests: 0 };
    console.error("[teachqueue] read-back: token failed", (e as Error)?.name);
    return { code: "read_failed", requests: 0 };
  }

  // --- Batched, paginated read: stop as soon as every id is matched ---
  const byPostId = new Map(rows.map((r) => [r.bufferPostId, r]));
  const unmatched = new Set(byPostId.keys());
  const oldest = rows.reduce((m, r) => (r.createdAt < m ? r.createdAt : m), rows[0].createdAt);
  const baseVars = { organizationId: u.orgId, channelIds: rows.map((r) => r.channelId), startDate: new Date(oldest.getTime() - 86_400_000) };
  let after: string | null = null;
  let requests = 0;
  let complete = false;
  let retried = false;
  let matched = 0;
  let stop: ReadResult | null = null;

  while (requests < MAX_READ_PAGES && unmatched.size > 0) {
    requests++;
    let page;
    try {
      const res = await graphql<unknown>(token, READ_STATUS_QUERY, readStatusVariables({ ...baseVars, after }));
      await recordWindows(db, res.windows, now);
      page = parsePostsPage(res.data);
    } catch (e) {
      if (isApiError(e) && e.windows) await recordWindows(db, e.windows, now);
      if (isApiError(e) && e.status === 429) {
        const ra = e.retryAfter ?? 60;
        if (ra <= SHORT_RETRY_MAX_S && !retried && requests < MAX_READ_PAGES) {
          retried = true;
          await sleep(ra * 1000);
          continue; // same page again; counts toward MAX_READ_PAGES
        }
        await recordBusy(db, new Date(now.getTime() + ra * 1000), now);
        stop = { code: "busy", retryAfter: ra, requests };
        break;
      }
      if ((e as Error)?.name === "ReconnectRequired" || (isApiError(e) && e.status === 401)) { stop = { code: "reconnect", requests }; break; }
      console.error("[teachqueue] read-back failed", (e as Error)?.name, isApiError(e) ? e.status : "");
      stop = { code: "read_failed", requests };
      break;
    }
    for (const p of page.posts) {
      const row = byPostId.get(p.id);
      if (!row || row.channelId !== p.channelId || !unmatched.has(p.id)) continue; // other channel / not ours
      await writeSeen(db, userId, row.id, p, now);
      unmatched.delete(p.id);
      matched++;
    }
    if (!page.hasNextPage) { complete = true; break; }
    if (!page.endCursor) break; // can't continue: incomplete
    after = page.endCursor;
  }

  // Not found only after a complete scan; otherwise "not read this time" (rows untouched).
  let missing = 0;
  if (complete) {
    for (const id of unmatched) { await writeMissing(db, userId, byPostId.get(id)!.id, now); missing++; }
  }
  if (stop) return { ...stop, matched, missing };

  await db.update(users).set({ postsReadAt: now }).where(eq(users.id, userId));
  return { code: complete || unmatched.size === 0 ? "read_ok" : "read_partial", requests, matched, missing };
}
