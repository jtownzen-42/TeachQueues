import type { Metadata } from "next";
import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireUserId } from "@/lib/lessons/data";
import { deskNoticesFrom, type Notice } from "@/lib/notices";
import { getValidAccessToken } from "@/lib/buffer/tokens";
import { minutesText } from "@/lib/buffer/posts";
import { rateLimitState } from "@/lib/buffer/ratelimit";
import { loadRateLimits, readBackStatuses, type ReadCode } from "@/lib/calendar/readback";
import { loadCalendarItems, type CalendarItem } from "@/lib/calendar/items";
import { calendarRange, dayLabel, groupByLocalDay } from "@/lib/calendar/range";
import { COUNTED_STATUSES } from "@/lib/calendar/status";
import { formatInZone, safeTimeZone } from "@/lib/tz";
import { refreshFromBuffer } from "./actions";
import { loadCalendarFacts } from "@/lib/onboarding/data";
import { btn, card, Crumbs, linkCls, muted, NoticeBox } from "@/components/desk/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Calendar · TeachQueue" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Auto-read outcomes worth telling the user about (others are silent). */
const AUTO_NOTICE: Partial<Record<ReadCode, Notice>> = {
  read_failed: { kind: "error", text: "Couldn't read statuses from Buffer. Your saved statuses are shown." },
  reconnect: { kind: "error", text: "Your Buffer connection has expired. Connect again to read statuses. Your saved statuses are shown." },
};

function Time({ iso, label, tz }: { iso: string; label: string; tz: string }) {
  return <time dateTime={iso} title={`${iso} (UTC)`}>{label} {formatInZone(iso, tz)}</time>;
}

function Row({ it, tz }: { it: CalendarItem; tz: string }) {
  const bad = it.status.key === "failed" || it.status.key === "send_failed" || it.status.key === "not_found";
  return (
    <li className="space-y-1 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${bad ? "border-red-500 text-red-800 dark:border-red-400 dark:text-red-300" : "border-neutral-400 dark:border-neutral-500"}`}>
          {it.status.label}
        </span>
        <span className="break-words">{it.network}{it.channelName ? ` · ${it.channelName}` : it.network !== "Not sent yet" ? " · Channel no longer connected" : ""}</span>
      </div>
      <p className="break-words"><Link href={it.source.href} className={linkCls}>{it.source.label}</Link></p>
      {it.excerpt && <p className={`break-words ${muted}`}>{it.excerpt}</p>}
      {it.status.detail && <p className={`break-words ${bad ? "text-red-700 dark:text-red-400" : muted}`}>{it.status.detail}</p>}
      <p className="flex flex-wrap items-center gap-x-3">
        <Time iso={it.iso} label={it.timeLabel} tz={tz} />
        {it.viewPost && <a href={it.viewPost} target="_blank" rel="noopener noreferrer" className={linkCls}>View post<span className="sr-only"> (opens in a new tab)</span></a>}
      </p>
    </li>
  );
}

export default async function CalendarPage({ searchParams }: Props) {
  const userId = await requireUserId();
  const sp = await searchParams;
  const db = getDb();
  const now = new Date();

  // (a) Auto read-back on render: only if the last read is > 10 min old and the guard allows it.
  // Never breaks the page: any failure shows the cached data with a notice.
  let autoNotice: Notice | null = null;
  try {
    const r = await readBackStatuses({ db, getToken: getValidAccessToken, now: () => now }, userId, { trigger: "auto" });
    autoNotice = AUTO_NOTICE[r.code] ?? null;
  } catch (e) {
    console.error("[teachqueue] calendar auto read failed", (e as Error)?.name);
    autoNotice = AUTO_NOTICE.read_failed!;
  }

  const [[u], limits] = await Promise.all([
    db.select({ tz: users.tz, readAt: users.postsReadAt, hasToken: sql<boolean>`${users.accessTokenEnc} is not null`, channels: users.channelsCache })
      .from(users).where(eq(users.id, userId)),
    loadRateLimits(db),
  ]);
  const tz = safeTimeZone(u?.tz);
  const items = await loadCalendarItems(db, userId, u?.channels ?? []);
  const facts = items.length === 0 ? await loadCalendarFacts(db, userId) : null;
  const range = calendarRange({ view: sp.view, start: sp.start }, tz, now);
  const unscheduled = items.filter((i) => !i.scheduled).sort((a, b) => b.iso.localeCompare(a.iso));
  const days = groupByLocalDay(items.filter((i) => i.scheduled), range, tz);
  const shown = [...unscheduled, ...days.flatMap((d) => d.items)];
  const guard = rateLimitState(limits, now);
  const paused = guard.low || Boolean(guard.busyUntil);
  const busyMin = guard.busyUntil ? minutesText(Math.ceil((guard.busyUntil.getTime() - now.getTime()) / 1000)) : null;
  const q = (start: string | null) => `/calendar?view=${range.view}${start ? `&start=${start}` : ""}`;
  const title = range.view === "week" ? `Week of ${dayLabel(range.start)}` : new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${range.start}T12:00:00Z`));

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 font-sans sm:px-8">
      <Crumbs items={[{ href: "/", label: "TeachQueue" }, { label: "Calendar" }]} />
      <h1 className="mt-2 text-3xl font-bold">Calendar</h1>
      <p className={`mt-2 ${muted}`}>Your lesson and campaign posts by day, in {tz.replace(/_/g, " ")}. Hover a time to see it in UTC.</p>
      {deskNoticesFrom(sp).map((n, i) => <NoticeBox key={i} n={n} />)}
      {autoNotice && <NoticeBox n={autoNotice} />}

      <section className={`mt-6 ${card} space-y-3`} aria-labelledby="status-heading">
        <h2 id="status-heading" className="sr-only">Status</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {COUNTED_STATUSES.map((s) => {
            const n = shown.filter((i) => i.status.key === s.key || s.also?.includes(i.status.key)).length;
            return <li key={s.key}><span className="font-semibold tabular-nums">{n}</span> {s.label}</li>;
          })}
        </ul>
        <p className="text-sm">
          {u?.readAt ? <>Last read from Buffer: <time dateTime={u.readAt.toISOString()} title={`${u.readAt.toISOString()} (UTC)`}>{formatInZone(u.readAt.toISOString(), tz)}</time></> : "Not read from Buffer yet"}
        </p>
        {guard.busyUntil ? (
          <p role="status" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            Buffer is busy, try again in {busyMin}. Your saved statuses are shown.
          </p>
        ) : guard.low && guard.lowest ? (
          <p role="status" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            Buffer&apos;s shared request budget is running low, so live refresh is paused for now. Your saved statuses are shown. Try again after{" "}
            <time dateTime={guard.lowest.resetAt.toISOString()} title={`${guard.lowest.resetAt.toISOString()} (UTC)`}>{formatInZone(guard.lowest.resetAt.toISOString(), tz)}</time>.
          </p>
        ) : null}
        {u?.hasToken ? (
          <form action={refreshFromBuffer} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="view" value={range.view} />
            <input type="hidden" name="start" value={range.start} />
            <button type="submit" className={btn} disabled={paused} aria-disabled={paused} aria-describedby={paused ? "refresh-why" : undefined}>Refresh from Buffer</button>
            {paused && <span id="refresh-why" className={`text-sm ${muted}`}>Paused to protect the shared Buffer budget.</span>}
          </form>
        ) : (
          <p className="text-sm"><a href="/api/auth/login" className={linkCls}>Connect with Buffer</a> to read status.</p>
        )}
      </section>

      <nav aria-label="Calendar range" className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Link href={q(range.prev)} className={btn}>Previous</Link>
          <Link href={q(null)} className={btn} aria-current={range.isCurrent ? "page" : undefined}>Today</Link>
          <Link href={q(range.next)} className={btn}>Next</Link>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href={`/calendar?view=week&start=${range.start}`} className={linkCls} aria-current={range.view === "week" ? "page" : undefined}>Week</Link>
          <span aria-hidden="true">·</span>
          <Link href={`/calendar?view=month&start=${range.start}`} className={linkCls} aria-current={range.view === "month" ? "page" : undefined}>Month</Link>
        </div>
      </nav>
      <h2 className="mt-4 text-xl font-semibold">{title}</h2>

      {items.length === 0 ? (
        <p className="mt-6">
          Nothing planned yet. Draft a lesson or a campaign first. <Link href="/products" className={linkCls}>Lesson desk</Link> · <Link href="/campaigns" className={linkCls}>Marketing desk</Link>
          <span className="mt-2 block">
            {!facts || facts.productCount === 0
              ? <>Next step: <Link href="/products" className={linkCls}>add a product</Link> (or load the samples there).</>
              : facts.draftCount === 0
                ? <>Next step: open a lesson and save its draft. <Link href="/products" className={linkCls}>Go to your products</Link></>
                : facts.sentCount === 0
                  ? "Next step: send a saved draft to Buffer from its lesson or campaign page."
                  : null}
          </span>
        </p>
      ) : (
        <>
          {unscheduled.length > 0 && (
            <section className="mt-6" aria-labelledby="unscheduled-heading">
              <h3 id="unscheduled-heading" className="text-lg font-semibold">Unscheduled</h3>
              <p className={`text-sm ${muted}`}>Drafts and Buffer drafts without a time yet.</p>
              <ul className="mt-2 divide-y rounded border border-neutral-300 dark:divide-neutral-700 dark:border-neutral-700">
                {unscheduled.map((it) => <Row key={it.key} it={it} tz={tz} />)}
              </ul>
            </section>
          )}
          {days.length === 0 ? (
            <p className={`mt-6 text-sm ${muted}`}>Nothing scheduled in this {range.view}.</p>
          ) : days.map((d) => (
            <section key={d.day} className="mt-6" aria-labelledby={`day-${d.day}`}>
              <h3 id={`day-${d.day}`} className="text-lg font-semibold"><time dateTime={d.day}>{dayLabel(d.day)}</time></h3>
              <ul className="mt-2 divide-y rounded border border-neutral-300 dark:divide-neutral-700 dark:border-neutral-700">
                {d.items.map((it) => <Row key={it.key} it={it} tz={tz} />)}
              </ul>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
