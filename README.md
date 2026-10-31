# TeachQueue

*Teach what you sell. Queue it in Buffer.* A #BufferCommit 2026 entry.

TeachQueue turns lessons from the products you sell into per-network posts and graphics,
runs three honesty checks, and queues the approved version in Buffer via the Buffer API.

## Stack
Next.js 15 (App Router) · Drizzle ORM + Postgres (Neon) · iron-session · Vercel Blob · Vercel Hobby.

## Buffer OAuth (confidential client + PKCE)
- `GET /api/auth/login` creates `state` + PKCE verifier (S256), stores them in a 10-minute encrypted
  HttpOnly cookie (`tq_oauth`), and redirects to `https://auth.buffer.com/auth`.
- `GET /api/auth/callback` checks state (constant-time), exchanges the code with client secret **and**
  `code_verifier`, reads `account { organizations }`, upserts the user, caches channels.
- Tokens are stored AES-256-GCM encrypted (`TOKEN_ENC_KEY`); the browser only holds our own session id.
- Refresh tokens are single-use: refresh happens under `SELECT … FOR UPDATE`, the new pair is persisted
  before use, and a spent token is never retried (`src/lib/buffer/tokens.ts`).
- `POST /api/auth/logout` forgets tokens; `?delete=1` deletes all of the user's data.
- Test mode (`TEST_MODE=true`, default) means posts are created with `saveToDraft: true`.

Pattern adapted from Buffer's MIT-licensed
[app-client-starter-app](https://github.com/bufferapp/buffer-sample-apps/tree/main/samples/app-client-starter-app).

## Local dev
```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev:https            # https://localhost:3000 (Buffer requires HTTPS, even on localhost)
npm test                     # PKCE, crypto, DST-safe time zone tests
npm run db:check             # apply migrations to in-memory Postgres (PGlite)
DATABASE_URL=... npm run db:migrate        # apply migrations to Neon (TCP 5432)
DATABASE_URL=... npm run db:migrate:http   # same, over Neon HTTPS (when 5432 is blocked)
```
Register `https://localhost:3000/api/auth/callback` as a redirect URI on the Buffer app client.
