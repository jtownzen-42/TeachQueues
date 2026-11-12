// ============================================================================================
// VERIFIED AGAINST THE LIVE BUFFER DOCS (developers.buffer.com, 2026-11-02): every argument, input
// field, enum value and selected field below exists with the type shown. Read-only: a `query`, never a mutation.
//
// Read-only post status read-back for the Calendar. Everything Buffer-schema-specific for reading
// posts lives in this one file: READ_STATUS_QUERY, readStatusVariables(), parsePostsPage(),
// readByIdQuery(), parsePostsById(). It is a `query` only: no mutation is ever built here.
// Docs checked 2026-11-02 and re-checked 2026-11-12:
//   https://developers.buffer.com/reference.md
//     posts(after: String, first: Int, input: PostsInput!): PostsResults!
//     post(input: PostInput!): Post!   -- PostInput { id: PostId! }
//     PostsInput { organizationId: OrganizationId!, filter: PostsFiltersInput, sort: [PostSortInput!] }
//     PostsFiltersInput { channelIds: [ChannelId!], status: [PostStatus!], startDate: DateTime
//       ("createdAt or dueAt date after startDate"), endDate, dueAt, createdAt: DateTimeComparator,
//       dueAtPresence: DateTimePresence }
//     DateTimeComparator { start ("equal to or after"), end ("equal to or before") }
//     DateTimePresence = present | absent  -- "absent cannot also match a date range"
//     PostSortInput { field: PostSortableKey! (dueAt | createdAt), direction: SortDirection! }
//     PostsResults { edges: [PostsEdge!], pageInfo: PaginationPageInfo! }, PaginationPageInfo { hasNextPage, endCursor }
//     Post { id, channelId, status: PostStatus!, dueAt, sentAt, externalLink, error: PostPublishingError }
//     PostPublishingError { message, rawError, supportUrl } -- we select `message` only (rawError is internal)
//     PostStatus = draft | error | needs_approval | scheduled | sending | sent
//   We filter the list on `createdAt: { start }` (not `startDate`) so unscheduled drafts whose
//   dueAt is null are not dropped by a date-range check. Unmatched ids are confirmed with `post(id)`
//   before the calendar marks them "not found".
//   https://developers.buffer.com/guides/posts-and-scheduling.md   ("Retrieving posts" example)
//   https://developers.buffer.com/examples/get-posts-for-channels.md (sort: [{ field, direction }])
//   https://developers.buffer.com/guides/pagination.md              (cursor pagination, page size 20-50)
//   https://developers.buffer.com/guides/api-limits.md              (cost 175,000, depth 25, max 30 aliases)
//   https://developers.buffer.com/guides/post-metrics.md            (metrics aren't available to app clients)
//   https://developers.buffer.com/guides/error-handling.md          (NOT_FOUND in errors[])
// Selected fields only: no text, no metrics.
// ============================================================================================
import { bufferGraphQLWithFieldErrors, type GraphQLErrorItem } from "./api";
import { sanitizeBufferMessage } from "./posts";
import type { RateLimitWindow } from "./ratelimit";

export const READ_STATUS_QUERY = /* GraphQL */ `
  query TeachQueuePostStatus($organizationId: OrganizationId!, $channelIds: [ChannelId!], $status: [PostStatus!], $createdAt: DateTimeComparator, $first: Int, $after: String) {
    posts(first: $first, after: $after, input: {
      organizationId: $organizationId,
      filter: { channelIds: $channelIds, status: $status, createdAt: $createdAt },
      sort: [{ field: createdAt, direction: desc }]
    }) {
      edges { node { id channelId status dueAt sentAt externalLink error { message } } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/** Posts per page (the docs recommend 20-50). */
export const READ_PAGE_SIZE = 50;

/** Max aliased `post(id)` fields per request (Buffer's alias limit is 30). */
export const READ_BY_ID_BATCH = 30;

export const BUFFER_POST_STATUSES = ["draft", "error", "needs_approval", "scheduled", "sending", "sent"] as const;
export type BufferPostStatus = (typeof BUFFER_POST_STATUSES)[number];

export function readStatusVariables(opts: { organizationId: string; channelIds: string[]; startDate: Date; after?: string | null }) {
  return {
    organizationId: opts.organizationId,
    channelIds: [...new Set(opts.channelIds)].sort(),
    // Name every status explicitly (as Buffer's examples do) so drafts are returned too.
    status: [...BUFFER_POST_STATUSES],
    // createdAt comparator, not startDate: startDate is documented as "createdAt or dueAt after
    // startDate", and absent dueAt cannot match a date range (dueAtPresence docs). Filtering on
    // createdAt keeps unscheduled drafts (dueAt null) in the result.
    createdAt: { start: opts.startDate.toISOString() },
    first: READ_PAGE_SIZE,
    ...(opts.after ? { after: opts.after } : {}),
  };
}

export type ReadPost = {
  id: string;
  channelId: string;
  /** null when Buffer sent a status we don't know: keep the previous one. */
  status: BufferPostStatus | null;
  dueAt: string | null;
  sentAt: string | null;
  externalLink: string | null;
  /** Buffer's publishing error message, sanitized and capped at 200 chars. */
  errorMessage: string | null;
};
export type ReadPage = { posts: ReadPost[]; hasNextPage: boolean; endCursor: string | null };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const iso = (v: unknown): string | null => {
  const s = str(v);
  return s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : null;
};

function parsePostNode(n: Record<string, unknown> | null | undefined): ReadPost | null {
  const id = str(n?.id);
  const channelId = str(n?.channelId);
  if (!n || !id || !channelId) return null;
  const st = str(n.status);
  const status = st && (BUFFER_POST_STATUSES as readonly string[]).includes(st) ? (st as BufferPostStatus) : null;
  const errMsg = str((n.error as { message?: unknown } | null | undefined)?.message);
  return {
    id, channelId, status,
    dueAt: iso(n.dueAt), sentAt: iso(n.sentAt), externalLink: str(n.externalLink),
    errorMessage: errMsg ? sanitizeBufferMessage(errMsg) : null,
  };
}

/** Tolerant parser for one `posts` page. Edges without a string id/channelId are skipped. */
export function parsePostsPage(data: unknown): ReadPage {
  const posts = (data as { posts?: unknown } | null | undefined)?.posts as
    | { edges?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } | null } | null | undefined;
  const out: ReadPost[] = [];
  const edges = Array.isArray(posts?.edges) ? posts!.edges : [];
  for (const e of edges as { node?: Record<string, unknown> | null }[]) {
    const p = parsePostNode(e?.node);
    if (p) out.push(p);
  }
  return {
    posts: out,
    hasNextPage: posts?.pageInfo?.hasNextPage === true,
    endCursor: str(posts?.pageInfo?.endCursor),
  };
}

const POST_FIELDS = "id channelId status dueAt sentAt externalLink error { message }";

/** Aliased `post(input: { id })` lookups. Ids go in variables, never into the query string. */
export function readByIdQuery(ids: string[]): { query: string; variables: Record<string, string> } {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.trim()))];
  const variables: Record<string, string> = {};
  const defs: string[] = [];
  const fields: string[] = [];
  unique.forEach((id, i) => {
    variables[`id${i}`] = id;
    defs.push(`$id${i}: PostId!`);
    fields.push(`p${i}: post(input: { id: $id${i} }) { ${POST_FIELDS} }`);
  });
  const query = `query TeachQueuePostById(${defs.join(", ")}) {\n  ${fields.join("\n  ")}\n}`;
  return { query, variables };
}

export type ByIdResult = { posts: ReadPost[]; notFound: string[]; fatal: boolean };

function errorCode(e: GraphQLErrorItem): string {
  return typeof e?.extensions?.code === "string" ? e.extensions.code.toUpperCase() : "";
}

function aliasFromPath(path: unknown[] | undefined): string | null {
  const first = path?.[0];
  return typeof first === "string" && /^p\d+$/.test(first) ? first : null;
}

function isNotFound(e: GraphQLErrorItem): boolean {
  if (errorCode(e) === "NOT_FOUND") return true;
  return /not found/i.test(e?.message ?? "");
}

/** Parse an aliased post-by-id response. Field-level NOT_FOUND → notFound; anything else is fatal. */
export function parsePostsById(data: unknown, ids: string[], errors: GraphQLErrorItem[] = []): ByIdResult {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.trim()))];
  const bag = (data ?? {}) as Record<string, unknown>;
  const posts: ReadPost[] = [];
  const notFound: string[] = [];
  let fatal = false;
  const errorsByAlias = new Map<string, GraphQLErrorItem[]>();
  for (const e of errors) {
    const alias = aliasFromPath(e.path);
    if (!alias) { fatal = true; continue; }
    const list = errorsByAlias.get(alias) ?? [];
    list.push(e);
    errorsByAlias.set(alias, list);
  }
  unique.forEach((id, i) => {
    const alias = `p${i}`;
    const node = bag[alias];
    const parsed = parsePostNode((node ?? null) as Record<string, unknown> | null);
    if (parsed) { posts.push(parsed); return; }
    const fieldErrors = errorsByAlias.get(alias) ?? [];
    if (fieldErrors.length === 0 || fieldErrors.every(isNotFound)) {
      notFound.push(id);
      return;
    }
    fatal = true;
  });
  return { posts, notFound, fatal };
}

/** One batched, read-only `post(id)` lookup. Throws BufferApiError / 401 / 429 like the list path. */
export async function fetchPostsByIds(
  token: string,
  ids: string[],
): Promise<{ result: ByIdResult; windows: RateLimitWindow[] }> {
  const { query, variables } = readByIdQuery(ids);
  if (Object.keys(variables).length === 0) return { result: { posts: [], notFound: [], fatal: false }, windows: [] };
  const res = await bufferGraphQLWithFieldErrors<Record<string, unknown>>(token, query, variables);
  return { result: parsePostsById(res.data, ids, res.errors), windows: res.windows };
}
