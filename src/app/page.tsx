import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getAppSession } from "@/lib/session";
import { getChannels } from "@/lib/buffer/sync";
import { channelErrorText, noticesFrom, type Notice } from "@/lib/notices";
import { isTestMode } from "@/lib/testmode";

export const dynamic = "force-dynamic";

type Loaded =
  | { state: "anon" }
  | { state: "expired" } // session cookie exists but Buffer tokens are gone
  | { state: "unavailable" }
  | {
      state: "connected";
      u: typeof users.$inferSelect;
      channels: NonNullable<(typeof users.$inferSelect)["channelsCache"]>;
      channelError: string | null;
    };

async function loadUser(): Promise<Loaded> {
  let userId: string | undefined;
  try {
    userId = (await getAppSession()).userId;
  } catch (e) {
    console.error("[teachqueue] session read failed", (e as Error).message);
    return { state: "unavailable" };
  }
  if (!userId) return { state: "anon" };
  try {
    const [u] = await getDb().select().from(users).where(eq(users.id, userId));
    if (!u) return { state: "anon" };
    if (!u.accessTokenEnc) return { state: "expired" };
    let channels = u.channelsCache ?? [];
    let channelError: string | null = null;
    try { channels = (await getChannels(u.id)).channels; } catch (e) { channelError = channelErrorText(e); }
    return { state: "connected", u, channels, channelError };
  } catch (e) {
    console.error("[teachqueue] home load failed", (e as Error).message);
    return { state: "unavailable" };
  }
}

const btn = "inline-block rounded border border-neutral-400 px-4 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";
const primary = "inline-block rounded bg-black px-5 py-3 font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";
const muted = "text-neutral-600 dark:text-neutral-400";

function NoticeBox({ n }: { n: Notice }) {
  return n.kind === "error"
    ? <p role="alert" className="mt-6 rounded border border-red-300 bg-red-50 p-3 text-red-800">{n.text}</p>
    : <p role="status" className="mt-6 rounded border border-neutral-300 p-3 dark:border-neutral-700">{n.text}</p>;
}

function ConnectSection({ lead }: { lead?: string }) {
  return (
    <section className="mt-8" aria-labelledby="connect-heading">
      <h2 id="connect-heading" className="sr-only">Connect</h2>
      {lead && <p className="mb-3">{lead}</p>}
      <p>Connect your Buffer account to pick channels and queue lesson posts. New accounts start in <strong>Test mode</strong>: posts land in Buffer as drafts and never publish.</p>
      {/* Plain <a>: this is a full-page OAuth redirect, so it must not be prefetched. */}
      <a href="/api/auth/login" className={`mt-4 ${primary}`}>Connect with Buffer</a>
    </section>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const data = await loadUser();
  const notices = noticesFrom(sp);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 font-sans sm:px-8">
      <h1 className="text-3xl font-bold">TeachQueue</h1>
      <p className={`mt-2 text-lg ${muted}`}>Teach what you sell. Queue it in Buffer.</p>

      {notices.map((n, i) => <NoticeBox key={i} n={n} />)}

      {data.state === "anon" && <ConnectSection />}
      {data.state === "expired" && <ConnectSection lead="Your Buffer connection has expired or was revoked. Connect again to continue." />}
      {data.state === "unavailable" && (
        <section className="mt-8">
          <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">TeachQueue can&apos;t reach its database right now. Please try again in a minute.</p>
        </section>
      )}
      {data.state === "connected" && (
        <section className="mt-8 space-y-4" aria-labelledby="channels-heading">
          <p className="break-words">Connected as <strong>{data.u.displayName || data.u.email}</strong>{data.u.orgName ? <> · organization <strong>{data.u.orgName}</strong></> : null}</p>
          <p className="text-sm">Time zone: {data.u.tz} · Test mode: <strong>{isTestMode(process.env.TEST_MODE, data.u.testMode) ? "ON (drafts only)" : "OFF"}</strong></p>
          <h2 id="channels-heading" className="text-xl font-semibold">Your Buffer channels</h2>
          {data.channelError && <p role="alert" className="text-red-700 dark:text-red-400">{data.channelError}</p>}
          {data.channels.length === 0 ? (
            <p>No channels yet. Connect a LinkedIn or Facebook page in Buffer, then re-sync.</p>
          ) : (
            <ul className="divide-y rounded border border-neutral-300 dark:divide-neutral-700 dark:border-neutral-700">
              {data.channels.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3">
                  <span className="min-w-0 break-words">{c.displayName || c.name}</span>
                  <span className={`text-sm ${muted}`}>{c.descriptor || c.service}{c.isLocked ? " · locked" : ""}{c.isDisconnected ? " · disconnected" : ""}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-3">
            <form action="/api/channels/sync" method="post"><button type="submit" className={btn}>Re-sync channels</button></form>
            <form action="/api/auth/logout" method="post"><button type="submit" className={btn}>Disconnect</button></form>
          </div>
          <details className="rounded border border-neutral-300 p-3 dark:border-neutral-700">
            <summary className="cursor-pointer">Delete my TeachQueue data</summary>
            <form action="/api/auth/logout" method="post" className="mt-3 space-y-3">
              <input type="hidden" name="delete" value="1" />
              <p className="text-sm">This removes your TeachQueue account, Buffer tokens and everything TeachQueue saved for you. Posts already in Buffer stay in Buffer.</p>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="confirm" required className="mt-1" />
                <span>I understand this can&apos;t be undone.</span>
              </label>
              <button type="submit" className="rounded border border-red-400 px-4 py-2 text-red-800 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">Delete my data</button>
            </form>
          </details>
        </section>
      )}
      <footer className={`mt-16 text-sm ${muted}`}>
        <p>TeachQueue is a #BufferCommit entry. Buffer post metrics aren&apos;t available to third-party apps, so results you see here are numbers you enter.</p>
        <p className="mt-2"><Link href="/privacy" className="underline">Privacy</Link></p>
      </footer>
    </main>
  );
}
