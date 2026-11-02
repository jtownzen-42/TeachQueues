// ============================================================================================
// VERIFIED AGAINST THE LIVE BUFFER DOCS (developers.buffer.com, 2026-11-02): every argument, input
// field, enum value and selected field below exists with the type shown. Read-only: a `query`, never a mutation.
//
// Read-only post status read-back for the Calendar. Everything Buffer-schema-specific for reading
// posts lives in this one file: READ_STATUS_QUERY, readStatusVariables(), parsePostsPage().
// It is a `query` only: no mutation is ever built here.
// Docs checked 2026-11-02:
//   https://developers.buffer.com/reference.md
//     posts(after: String, first: Int, input: PostsInput!): PostsResults!
//     PostsInput { organizationId: OrganizationId!, filter: PostsFiltersInput, sort: [PostSortInput!] }
//     PostsFiltersInput { channelIds: [ChannelId!], status: [PostStatus!], startDate: DateTime
//       ("createdAt or dueAt date after startDate"), endDate, dueAt, createdAt, ... }
//     PostSortInput { field: PostSortableKey! (dueAt | createdAt), direction: SortDirection! }
//     PostsResults { edges: [PostsEdge!], pageInfo: PaginationPageInfo! }, PaginationPageInfo { hasNextPage, endCursor }
//     Post { id, channelId, status: PostStatus!, dueAt, sentAt, externalLink, error: PostPublishingError }
//     PostPublishingError { message, rawError, supportUrl } -- we select `message` only (rawError is internal)
//     PostStatus = draft | error | needs_approval | scheduled | sending | sent
//   https://developers.buffer.com/guides/posts-and-scheduling.md   ("Retrieving posts" example)
//   https://developers.buffer.com/examples/get-posts-for-channels.md (sort: [{ field, direction }])
//   https://developers.buffer.com/guides/pagination.md              (cursor pagination, page size 20-50)
//   https://developers.buffer.com/guides/api-limits.md              (cost 175,000, depth 25, max 30 aliases)
//   https://developers.buffer.com/guides/post-metrics.md            (metrics aren't available to app clients)
// Selected fields only: no text, no metrics.
// ============================================================================================
import { sanitizeBufferMessage } from "./posts";

export const READ_STATUS_QUERY = /* GraphQL */ `
  query TeachQueuePostStatus($organizationId: OrganizationId!, $channelIds: [ChannelId!], $startDate: DateTime, $first: Int, $after: String) {
    posts(first: $first, after: $after, input: {
      organizationId: $organizationId,
      filter: { channelIds: $channelIds, startDate: $startDate },
      sort: [{ field: createdAt, direction: desc }]
    }) {
      edges { node { id channelId status dueAt sentAt externalLink error { message } } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/** Posts per page (the docs recommend 20-50). */
export const READ_PAGE_SIZE = 50;

export const BUFFER_POST_STATUSES = ["draft", "error", "needs_approval", "scheduled", "sending", "sent"] as const;
export type BufferPostStatus = (typeof BUFFER_POST_STATUSES)[number];

export function readStatusVariables(opts: { organizationId: string; channelIds: string[]; startDate: Date; after?: string | null }) {
  return {
    organizationId: opts.organizationId,
    channelIds: [...new Set(opts.channelIds)].sort(),
    startDate: opts.startDate.toISOString(),
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

/** Tolerant parser for one `posts` page. Edges without a string id/channelId are skipped. */
export function parsePostsPage(data: unknown): ReadPage {
  const posts = (data as { posts?: unknown } | null | undefined)?.posts as
    | { edges?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } | null } | null | undefined;
  const out: ReadPost[] = [];
  const edges = Array.isArray(posts?.edges) ? posts!.edges : [];
  for (const e of edges as { node?: Record<string, unknown> | null }[]) {
    const n = e?.node;
    const id = str(n?.id);
    const channelId = str(n?.channelId);
    if (!n || !id || !channelId) continue;
    const st = str(n.status);
    const status = st && (BUFFER_POST_STATUSES as readonly string[]).includes(st) ? (st as BufferPostStatus) : null;
    const errMsg = str((n.error as { message?: unknown } | null | undefined)?.message);
    out.push({
      id, channelId, status,
      dueAt: iso(n.dueAt), sentAt: iso(n.sentAt), externalLink: str(n.externalLink),
      errorMessage: errMsg ? sanitizeBufferMessage(errMsg) : null,
    });
  }
  return {
    posts: out,
    hasNextPage: posts?.pageInfo?.hasNextPage === true,
    endCursor: str(posts?.pageInfo?.endCursor),
  };
}
