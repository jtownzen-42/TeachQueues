import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getCampaign } from "@/lib/campaigns/data";
import { campaignLinks } from "@/lib/campaigns/utm";
import { CAMPAIGN_NETWORK_LABELS, CAMPAIGN_NETWORKS } from "@/lib/campaigns/templates";
import { parseId, requireUserId } from "@/lib/lessons/data";
import { NETWORK_LABELS } from "@/lib/lessons/templates";
import { networkForService } from "@/lib/buffer/posts";
import { deskNoticesFrom } from "@/lib/notices";
import { addDays, localDayKey } from "@/lib/calendar/range";
import { calendarStatus, viewPostHref } from "@/lib/calendar/status";
import { formatCents } from "@/lib/results/money";
import { summarizeResults } from "@/lib/results/summary";
import { campaignPosts, listResultDays, sentPostCount } from "@/lib/results/service";
import { formatInZone, safeTimeZone } from "@/lib/tz";
import { deleteResultDay } from "@/app/campaigns/results-actions";
import { ResultDayForm } from "@/components/desk/ResultDayForm";
import { card, Crumbs, danger, linkCls, muted, NoticeBox } from "@/components/desk/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Results · TeachQueue" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const num = (n: number) => n.toLocaleString("en-US");
const cell = "px-2 py-1 text-right tabular-nums whitespace-nowrap";

/** Zero Buffer requests: everything comes from our database. */
export default async function ResultsPage({ params, searchParams }: Props) {
  const userId = await requireUserId();
  const [{ id: rawId }, sp] = await Promise.all([params, searchParams]);
  const id = parseId(rawId);
  if (!id) notFound();
  const row = await getCampaign(userId, id);
  if (!row) notFound();
  const { campaign, product } = row;
  const db = getDb();
  const [[u], days, posts] = await Promise.all([
    db.select({ tz: users.tz, channels: users.channelsCache }).from(users).where(eq(users.id, userId)),
    listResultDays(db, userId, campaign.id),
    campaignPosts(db, userId, campaign.id),
  ]);
  const tz = safeTimeZone(u?.tz);
  const now = new Date();
  const today = localDayKey(now, tz);
  const summary = summarizeResults(days, sentPostCount(posts));
  const links = product ? campaignLinks(campaign, product) : null;
  const channelName = (cid: string) => { const c = (u?.channels ?? []).find((x) => x.id === cid); return c ? c.displayName || c.name : "Channel no longer connected"; };
  const sentRows = posts.filter((p) => p.post.bufferPostId);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 font-sans sm:px-8">
      <Crumbs items={[{ href: "/", label: "TeachQueue" }, { href: "/campaigns", label: "Campaigns" }, { href: `/campaigns/${campaign.id}`, label: campaign.name }, { label: "Results" }]} />
      <h1 className="mt-2 break-words text-3xl font-bold">Results · {campaign.name}</h1>
      <p className="mt-2 font-medium">Numbers you enter. Buffer doesn&apos;t share post metrics with third-party apps.</p>
      {deskNoticesFrom(sp).map((n, i) => <NoticeBox key={i} n={n} />)}

      <section className={`mt-6 ${card}`} aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="mb-3 text-xl font-semibold">Summary</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt>Visits</dt><dd className="text-right tabular-nums">{num(summary.totals.visits)}</dd>
          <dt>Purchases</dt><dd className="text-right tabular-nums">{num(summary.totals.purchases)}</dd>
          <dt>Conversion</dt><dd className="text-right tabular-nums">{summary.conversion ?? "—"}</dd>
          <dt>Revenue</dt><dd className="text-right tabular-nums">{formatCents(summary.totals.revenue)}</dd>
          <dt>Fees, refunds, ad spend</dt><dd className="text-right tabular-nums">{formatCents(summary.totals.fees + summary.totals.refunds + summary.totals.adSpend)}</dd>
          <dt className="font-semibold">Net revenue</dt><dd className="text-right font-semibold tabular-nums">{formatCents(summary.net)}</dd>
          <dt>Revenue per sent post</dt>
          <dd className="text-right tabular-nums">{summary.revenuePerSentPost === null ? "—" : formatCents(summary.revenuePerSentPost)}</dd>
        </dl>
        <p className={`mt-3 text-xs ${muted}`}>
          Net revenue = revenue − fees − refunds − ad spend.{" "}
          {summary.revenuePerSentPost === null ? "No posts have been read back as sent yet." : `Revenue per sent post divides total revenue by ${summary.sentPosts} post${summary.sentPosts === 1 ? "" : "s"} read back as sent (rounded to the nearest cent).`}
        </p>
      </section>

      <section id="add" className={`mt-8 scroll-mt-4 ${card}`} aria-labelledby="add-heading">
        <h2 id="add-heading" className="mb-4 text-xl font-semibold">Add or edit a day</h2>
        <ResultDayForm campaignId={campaign.id} defaultDay={today} latestDay={addDays(today, 1)} />
      </section>

      <section id="days" className="mt-8 scroll-mt-4" aria-labelledby="days-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="days-heading" className="text-xl font-semibold">Days</h2>
          {days.length > 0 && <a href={`/api/campaigns/${campaign.id}/results.csv`} className={`text-sm ${linkCls}`} download>Download CSV</a>}
        </div>
        {days.length === 0 ? (
          <p className={`mt-2 text-sm ${muted}`}>No numbers yet. Add your first day above.</p>
        ) : (
          <div className="relative mt-2 overflow-x-auto rounded border border-neutral-300 dark:border-neutral-700">
            <table className="min-w-full text-sm">
              <caption className="sr-only">Daily results, newest first, with totals</caption>
              <thead>
                <tr className="border-b border-neutral-300 dark:border-neutral-700">
                  <th scope="col" className="px-2 py-1 text-left">Day</th>
                  {["Visits", "Purchases", "Revenue", "Fees", "Refunds", "Ad spend", "Net", ""].map((h, i) => <th key={i} scope="col" className={cell}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day} className="border-b border-neutral-200 dark:border-neutral-800">
                    <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-normal">{d.day}</th>
                    <td className={cell}>{num(d.visits)}</td><td className={cell}>{num(d.purchases)}</td>
                    <td className={cell}>{formatCents(d.revenue)}</td><td className={cell}>{formatCents(d.fees)}</td>
                    <td className={cell}>{formatCents(d.refunds)}</td><td className={cell}>{formatCents(d.adSpend)}</td>
                    <td className={cell}>{formatCents(d.net)}</td>
                    <td className="px-2 py-1">
                      <form action={deleteResultDay}>
                        <input type="hidden" name="campaignId" value={campaign.id} />
                        <input type="hidden" name="day" value={d.day} />
                        <button type="submit" className={`${danger} px-2 py-0.5 text-xs`}>Delete<span className="sr-only"> {d.day}</span></button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <th scope="row" className="px-2 py-1 text-left">Total</th>
                  <td className={cell}>{num(summary.totals.visits)}</td><td className={cell}>{num(summary.totals.purchases)}</td>
                  <td className={cell}>{formatCents(summary.totals.revenue)}</td><td className={cell}>{formatCents(summary.totals.fees)}</td>
                  <td className={cell}>{formatCents(summary.totals.refunds)}</td><td className={cell}>{formatCents(summary.totals.adSpend)}</td>
                  <td className={cell}>{formatCents(summary.net)}</td><td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8" aria-labelledby="posts-heading">
        <h2 id="posts-heading" className="text-xl font-semibold">Posts in Buffer</h2>
        {sentRows.length === 0 ? (
          <p className={`mt-2 text-sm ${muted}`}>None yet. Send the approved version from the campaign page.</p>
        ) : (
          <ul className="mt-2 divide-y rounded border border-neutral-300 dark:divide-neutral-700 dark:border-neutral-700">
            {sentRows.map(({ post: p }) => {
              const n = networkForService(p.service);
              const st = calendarStatus({ draftStatus: "queued", post: p });
              const href = st.key === "sent" ? viewPostHref(p.externalLink) : null;
              const when = p.dueAt ?? p.sentAt ?? p.createdAt;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                  <span className="rounded border border-neutral-400 px-2 py-0.5 text-xs font-semibold dark:border-neutral-500">{st.label}</span>
                  <span className="break-words">{n ? NETWORK_LABELS[n] : p.service} · {channelName(p.channelId)}</span>
                  <time dateTime={when.toISOString()} title={`${when.toISOString()} (UTC)`}>{formatInZone(when.toISOString(), tz)}</time>
                  {href && <a href={href} target="_blank" rel="noopener noreferrer" className={linkCls}>View post<span className="sr-only"> (opens in a new tab)</span></a>}
                </li>
              );
            })}
          </ul>
        )}
        <p className={`mt-2 text-xs ${muted}`}>Statuses come from the last read on the <Link href="/calendar" className={linkCls}>Calendar</Link>; this page never contacts Buffer.</p>
      </section>

      {links && (
        <section className="mt-8" aria-labelledby="utm-heading">
          <h2 id="utm-heading" className="text-xl font-semibold">Tracking links</h2>
          <p className={`mt-1 text-sm ${muted}`}>Use these to match visits in your own analytics to each network.</p>
          <ul className="mt-2 space-y-1">
            {CAMPAIGN_NETWORKS.map((n) => <li key={n} className="break-all text-sm"><span className="font-medium">{CAMPAIGN_NETWORK_LABELS[n]}:</span> <span className="font-mono">{links[n]}</span></li>)}
          </ul>
        </section>
      )}
      <p className="mt-8 text-sm"><Link href={`/campaigns/${campaign.id}`} className={linkCls}>← Back to the campaign</Link></p>
    </main>
  );
}
