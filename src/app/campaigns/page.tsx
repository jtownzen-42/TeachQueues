import type { Metadata } from "next";
import Link from "next/link";
import { listCampaigns } from "@/lib/campaigns/data";
import { listProducts, requireUserId } from "@/lib/lessons/data";
import { deskNoticesFrom } from "@/lib/notices";
import { Crumbs, linkCls, muted, NoticeBox, primary } from "@/components/desk/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaigns · TeachQueue" };

function dates(startsOn: string | null, endsOn: string | null): string | null {
  if (startsOn && endsOn) return `${startsOn} → ${endsOn}`;
  if (startsOn) return `from ${startsOn}`;
  if (endsOn) return `until ${endsOn}`;
  return null;
}

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const userId = await requireUserId();
  const [sp, items, productRows] = await Promise.all([searchParams, listCampaigns(userId), listProducts(userId)]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 font-sans sm:px-8">
      <Crumbs items={[{ href: "/", label: "TeachQueue" }, { label: "Campaigns" }]} />
      <h1 className="mt-2 text-3xl font-bold">Marketing desk</h1>
      <p className={`mt-2 ${muted}`}>Write a short brief for one of your products, get tracked copy and a creative, approve the exact version, then send it to Buffer as drafts.</p>
      {deskNoticesFrom(sp).map((n, i) => <NoticeBox key={i} n={n} />)}

      {productRows.length === 0 ? (
        <p className="mt-8">Add a product first, then create a campaign for it. <Link href="/products" className={linkCls}>Go to products</Link></p>
      ) : (
        <p className="mt-8"><Link href="/campaigns/new" className={primary}>New campaign</Link></p>
      )}

      <section className="mt-8" aria-labelledby="campaigns-heading">
        <h2 id="campaigns-heading" className="text-xl font-semibold">Your campaigns</h2>
        {items.length === 0 ? (
          <p className={`mt-3 ${muted}`}>No campaigns yet.</p>
        ) : (
          <ul className="mt-3 divide-y rounded border border-neutral-300 dark:divide-neutral-700 dark:border-neutral-700">
            {items.map(({ campaign: c, productName, status }) => {
              const d = dates(c.startsOn, c.endsOn);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3">
                  <Link href={`/campaigns/${c.id}`} className={`min-w-0 break-words font-medium ${linkCls}`}>{c.name}</Link>
                  <span className="text-sm font-medium">{status}</span>
                  <span className={`w-full break-words text-sm ${muted}`}>{productName ?? "No product"}{d ? ` · ${d}` : ""}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
