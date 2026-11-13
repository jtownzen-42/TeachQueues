# TeachQueue

![Buffer API](https://img.shields.io/endpoint?url=https%3A%2F%2Fteachqueue-app.vercel.app%2Fapi%2Fhealth%2Fbadge)
([live status](https://teachqueue-app.vercel.app/api/health))

**TeachQueue — Teach what you sell. Queue it in Buffer.**

- Live app: [teachqueue-app.vercel.app](https://teachqueue-app.vercel.app)
- How it works: [teachqueue-app.vercel.app/how-it-works](https://teachqueue-app.vercel.app/how-it-works)
- Demo video: [youtu.be/NgxPCyZ2vwQ](https://youtu.be/NgxPCyZ2vwQ)
- Privacy: [teachqueue-app.vercel.app/privacy](https://teachqueue-app.vercel.app/privacy)

Built for [Buffer Commit 2026](https://commit.buffer.com) (Oct 28–Nov 13).

Credit: Built by Jason Townzen (X [@Jtownzen2](https://x.com/Jtownzen2)).

## What it does

TeachQueue turns short lessons about the products you sell into ready-to-review
posts, then sends the version you choose to your Buffer account as drafts. You
review, schedule, and publish inside Buffer.

**Products and lessons.** Add a product, then write lessons in one of three
formats: a glossary term, a prompt demonstration, or a common misconception.

**Lesson graphic.** Preview a 1080×1080 branded card and save it. A saved image
can be attached when a draft is sent to Buffer (`assets: [{ image: { url } }]`).

**Per-network copy.** Fixed templates (no AI writing) draft text for LinkedIn,
Facebook, and X. You can edit and save the copy before sending. Limits are 3,000
characters for LinkedIn, 2,000 for Facebook, and 280 weighted characters for X.

**Send to Buffer as drafts.** For a connected LinkedIn, Facebook, or X channel,
TeachQueue creates a Buffer post with `saveToDraft: true`. You can add it to the
queue (`mode: addToQueue`) or pick a specific time in your time zone (`mode:
customScheduled` plus `dueAt` in UTC). X copy is generated for every lesson; it
is sent through Buffer only when an X (or Twitter) channel is connected and you
choose that channel. Other Buffer services (for example YouTube) can appear
after a re-sync but are not send targets.

**Marketing desk.** Write a campaign brief for one of your products. TeachQueue
adds per-network UTM links, drafts variants for X, Facebook, LinkedIn, and
Reddit, and builds a creative in three sizes. Reddit is copy-only and is never
sent to Buffer. You tick two honesty checks (the claims are accurate; the
product name and link are correct) and approve the exact version, which is a
hash of the texts, links, and current image. Only that approved version can be
sent, and it still goes as a Buffer draft.

**Calendar.** A read-only calendar shows your posts by day and reads their
status back from Buffer when you open it or press Refresh. The read includes
drafts, so a successful send can show “Draft in Buffer.” Other labels include
awaiting approval, scheduled, sending, sent, failed, and not found in Buffer.

**Results.** Campaign results are numbers you type in. Buffer does not share
post metrics with third-party app clients.

**Getting started.** A home-page checklist walks through connecting a Buffer
channel and re-syncing, adding a product and a lesson, saving a lesson graphic,
and sending one draft. It is guidance only and does not block the rest of the
app.

**Test mode.** `TEST_MODE` defaults to on. In test mode every create-post
payload is forced through `draftSafe()`, so TeachQueue can only create drafts
and will not publish.

## Buffer API surface

OAuth and GraphQL live under `src/lib/buffer/`. Pattern adapted from Buffer’s
MIT-licensed
[app-client-starter-app](https://github.com/bufferapp/buffer-sample-apps/tree/main/samples/app-client-starter-app).

### OAuth (authorization code + PKCE, confidential client)

1. `GET /api/auth/login` creates `state` and a PKCE verifier (S256), stores
   them in a 10-minute encrypted HttpOnly cookie (`tq_oauth`), and redirects to
   `https://auth.buffer.com/auth` with `response_type=code`,
   `code_challenge_method=S256`, and `prompt=consent`. Default scopes are
   `account:read posts:read posts:write offline_access` (`BUFFER_SCOPES` can
   override).
2. `GET /api/auth/callback` compares `state` in constant time, exchanges the
   code at `https://auth.buffer.com/token` with the client secret **and**
   `code_verifier` (`grant_type=authorization_code`), runs `TeachQueueAccount`,
   upserts the user, and caches channels.
3. Refresh uses `grant_type=refresh_token`. Refresh tokens are treated as
   single-use: the refresh runs under `SELECT … FOR UPDATE`, the new pair is
   persisted before use, and a spent token is never retried
   (`src/lib/buffer/tokens.ts`).
4. Tokens are stored AES-256-GCM encrypted (`TOKEN_ENC_KEY`). The browser
   cookie (`tq_session`) holds only TeachQueue’s own session id, never a Buffer
   token.
5. `POST /api/auth/logout` forgets tokens; `delete=1` removes the user’s
   TeachQueue data.
6. `POST /api/channels/sync` (Re-sync channels) re-runs `TeachQueueChannels`,
   with a short cooldown.

In production, `src/middleware.ts` 308-redirects alias hosts to the host in
`BUFFER_REDIRECT_URI` so OAuth cookies and `redirect_uri` always match.

### GraphQL (POST `https://api.buffer.com`)

Named operations, as in the code:

- `query TeachQueueAccount` — `account { id email name timezone organizations
  { id name } }` (`ACCOUNT_QUERY` in `src/lib/buffer/api.ts`).
- `query TeachQueueChannels($organizationId: OrganizationId!)` —
  `channels(input: { organizationId }) { id name displayName service descriptor
  avatar isDisconnected isLocked }` (`CHANNELS_QUERY`).
- `mutation TeachQueueCreatePost($input: CreatePostInput!)` — `createPost(input)`
  selecting `PostActionSuccess.post { id status dueAt externalLink }` or
  `MutationError.message` (`CREATE_POST_MUTATION` in `src/lib/buffer/posts.ts`).
  Input is built by `buildCreatePostInput()` with `saveToDraft: true`,
  `schedulingType: automatic`, `mode` `addToQueue` or `customScheduled` (with
  `dueAt` in UTC), Facebook `metadata.facebook.type: "post"` when the channel
  is Facebook, and optional `assets: [{ image: { url } }]`. Every payload also
  passes through `draftSafe()` in `src/lib/testmode.ts`.
- `query TeachQueuePostStatus` — `posts(first, after, input: { organizationId,
  filter: { channelIds, status, startDate }, sort: [{ field: createdAt,
  direction: desc }] })` (`READ_STATUS_QUERY` in `src/lib/buffer/read.ts`). The
  status filter names every `PostStatus` (`draft`, `error`, `needs_approval`,
  `scheduled`, `sending`, `sent`) so drafts are included. Selected fields only:
  no post text, no metrics.

The public `GET /api/health` probe (and the shields.io badge at
`GET /api/health/badge`) is an unauthenticated GET to `https://api.buffer.com`
— no user token and no client secret — used only to report whether that host
is reachable.

## Quick start

```bash
git clone https://github.com/jtownzen-42/TeachQueues.git
cd TeachQueues
npm install
cp .env.example .env.local
```

Fill in `.env.local` (names only; never commit real values):

| Variable | Purpose |
| --- | --- |
| `BUFFER_CLIENT_ID` | Buffer app client id |
| `BUFFER_CLIENT_SECRET` | Buffer app client secret |
| `BUFFER_REDIRECT_URI` | OAuth callback URL (local default is `https://localhost:3000/api/auth/callback`) |
| `BUFFER_SCOPES` | Optional scope override; default is `account:read posts:read posts:write offline_access` |
| `DATABASE_URL` | Postgres connection string (Neon works; URLs are normalized to `sslmode=verify-full`) |
| `SESSION_SECRET` | Secret for the iron-session cookies |
| `TOKEN_ENC_KEY` | 32-byte, base64 key used to encrypt Buffer tokens at rest |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for saving lesson and campaign images |
| `TEST_MODE` | `true` (default) forces `saveToDraft: true` on every Buffer create-post |

Register a Buffer app and add the redirect URI above as a callback on that
app. Apply migrations (`npm run db:check` against in-memory Postgres, or
`npm run db:migrate` / `npm run db:migrate:http` against `DATABASE_URL`), then
start the app:

```bash
npm run dev          # http://localhost:3000
npm run dev:https    # https://localhost:3000 — Buffer requires HTTPS, even on localhost
npm test             # Vitest: 521 tests
```

## Architecture

- **Next.js 15.5.28** (App Router) and React 19, deployed on Vercel at
  [teachqueue-app.vercel.app](https://teachqueue-app.vercel.app).
- **Postgres** via Drizzle ORM (`src/db`) for users, products, lessons, drafts,
  campaigns, and calendar read-back.
- **Vercel Blob** (`src/lib/graphics`) for saved lesson and campaign images.
- **Key folders:** `src/app` (pages and route handlers, including
  `/how-it-works`, `/privacy`, `/calendar`, `/campaigns`, and `/api/health`),
  `src/components/desk` (UI), `src/lib/buffer` (OAuth, GraphQL, send,
  read-back), `src/lib/lessons`, `src/lib/campaigns`, `src/lib/calendar`,
  `src/lib/graphics`, `src/lib/onboarding`, `src/lib/health`, `src/db`,
  `tests`.

## Safety and privacy

- Test mode is on by default. TeachQueue creates Buffer drafts only; nothing
  is published from the app. You publish from Buffer yourself.
- `buildCreatePostInput()` always sets `saveToDraft: true`, and `draftSafe()`
  refuses a `false` value while test mode is on.
- Buffer access and refresh tokens are encrypted at rest with AES-256-GCM.
  They never reach the browser.
- Disconnect forgets tokens and ends the session. Delete my data removes the
  TeachQueue account and everything stored for it. See
  [Privacy](https://teachqueue-app.vercel.app/privacy).
