import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getAppSession } from "@/lib/session";
import { getChannels } from "@/lib/buffer/sync";
import { channelErrorText, deskNoticesFrom, noticesFrom, type Notice } from "@/lib/notices";
import { isTestMode } from "@/lib/testmode";
import { LANDING } from "@/lib/onboarding/landing";
import { loadOnboardingFacts } from "@/lib/onboarding/data";
import { onboardingProgress, type OnboardingFacts } from "@/lib/onboarding/progress";
import { BrandForm, GettingStarted, LoadSamplesForm, RemoveSamplesDetails } from "@/components/desk/Onboarding";

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
      facts: OnboardingFacts;
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
    // Checklist facts: one DB query, no Buffer calls (channels come from the cache just refreshed above).
    const facts = { ...(await loadOnboardingFacts(getDb(), u.id)), channels };
    return { state: "connected", u, channels, channelError, facts };
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

/** Public landing for signed-out visitors and the "session expired" state. */
function Landing({ lead }: { lead?: string }) {
  return (
    <>
      <section className="mt-8" aria-labelledby="what-heading">
        <h2 id="what-heading" className="sr-only">What TeachQueue does</h2>
        {lead && <p role="status" className="mb-4 rounded border border-neutral-300 p-3 dark:border-neutral-700">{lead}</p>}
        <p className="text-lg">{LANDING.intro}</p>
        {/* Plain <a>: this is a full-page OAuth redirect, so it must not be prefetched. */}
        <a href="/api/auth/login" className={`mt-6 ${primary}`}>{LANDING.signIn}</a>
      </section>
      <section className="mt-10" aria-labelledby="how-heading">
        <h2 id="how-heading" className="text-xl font-semibold">How it works</h2>
        <ol className="mt-3 list-decimal space-y-3 pl-6">
          {LANDING.steps.map((st) => (
            <li key={st.title}><strong>{st.title}.</strong> {st.body}</li>
          ))}
        </ol>
        <p className="mt-3"><Link href="/how-it-works" className="underline">How it works, in more detail</Link></p>
      </section>
      <section className="mt-10" aria-labelledby="testmode-heading">
        <h2 id="testmode-heading" className="text-xl font-semibold">Test mode</h2>
        <p className="mt-2">{LANDING.testMode}</p>
      </section>
    </>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const data = await loadUser();
  const notices = noticesFrom(sp);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 font-sans sm:px-8">
      {data.state === "anon" || data.state === "expired" ? (
        <>
          <p className={`text-lg font-semibold ${muted}`}>{LANDING.product}</p>
          <h1 className="mt-1 text-3xl font-bold sm:text-4xl">{LANDING.headline}</h1>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-bold">TeachQueue</h1>
          <p className={`mt-2 text-lg ${muted}`}>{LANDING.headline}</p>
        </>
      )}

      {notices.map((n, i) => <NoticeBox key={i} n={n} />)}
      {deskNoticesFrom(sp).map((n, i) => <NoticeBox key={`d${i}`} n={n} />)}

      {data.state === "anon" && <Landing />}
      {data.state === "expired" && <Landing lead={LANDING.expiredLead} />}
      {data.state === "unavailable" && (
        <section className="mt-8">
          <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">TeachQueue can&apos;t reach its database right now. Please try again in a minute.</p>
        </section>
      )}
      {data.state === "connected" && (() => {
        const progress = onboardingProgress(data.facts);
        const hasSamples = data.facts.sampleProductCount > 0;
        return (
        <>
        <GettingStarted progress={progress} hasSamples={hasSamples} productCount={data.facts.productCount} />
        <section className="mt-8 space-y-4" aria-labelledby="channels-heading">
          <p className="break-words">Connected as <strong>{data.u.displayName || data.u.email}</strong>{data.u.orgName ? <> · organization <strong>{data.u.orgName}</strong></> : null}</p>
          <p className="text-sm">Time zone: {data.u.tz} · Test mode: <strong>{isTestMode(process.env.TEST_MODE, data.u.testMode) ? "ON (drafts only)" : "OFF"}</strong></p>
          <p className="flex flex-wrap gap-3"><Link href="/products" className={primary}>Open the Lesson desk</Link><Link href="/campaigns" className={primary}>Open the Marketing desk</Link><Link href="/calendar" className={primary}>Open the Calendar</Link></p>
          <p className={`text-sm ${muted}`}>Add your products, write lessons, and get ready-to-post copy for X, Facebook and LinkedIn.</p>
          <h2 id="channels-heading" className="text-xl font-semibold">Your Buffer channels</h2>
          {data.channelError && <p role="alert" className="text-red-700 dark:text-red-400">{data.channelError}</p>}
          {data.channels.length === 0 ? (
            <p>No channels yet. Connect an X, Facebook or LinkedIn channel in Buffer (buffer.com), then press Re-sync channels.</p>
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
          <BrandForm saved={data.u.brandName} suggestion={data.u.orgName} />
          {progress.visibility === "hidden" && !hasSamples && (
            <p className="flex flex-wrap items-center gap-3 text-sm"><LoadSamplesForm back="/" /> <span className={muted}>Two fictional products with one lesson each, to try things out.</span></p>
          )}
          {hasSamples && <RemoveSamplesDetails back="/" />}
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
        </>
        );
      })()}
      <footer className={`mt-16 text-sm ${muted}`}>
        <p>{LANDING.footer} {LANDING.metricsNote}</p>
        <p className="mt-2"><Link href="/how-it-works" className="underline">How it works</Link> · <Link href="/privacy" className="underline">Privacy</Link></p>
      </footer>
    </main>
  );
}
