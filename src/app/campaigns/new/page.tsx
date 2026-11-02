import type { Metadata } from "next";
import Link from "next/link";
import { listProducts, requireUserId } from "@/lib/lessons/data";
import { CampaignBriefForm } from "@/components/desk/CampaignBriefForm";
import { card, Crumbs, linkCls, muted } from "@/components/desk/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New campaign · TeachQueue" };

export default async function NewCampaignPage() {
  const userId = await requireUserId();
  const productRows = await listProducts(userId);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 font-sans sm:px-8">
      <Crumbs items={[{ href: "/", label: "TeachQueue" }, { href: "/campaigns", label: "Campaigns" }, { label: "New campaign" }]} />
      <h1 className="mt-2 text-3xl font-bold">New campaign</h1>
      {productRows.length === 0 ? (
        <p className="mt-6">Add a product first, then create a campaign for it. <Link href="/products" className={linkCls}>Go to products</Link></p>
      ) : (
        <section className={`mt-6 ${card}`} aria-labelledby="brief-heading">
          <h2 id="brief-heading" className="mb-1 text-xl font-semibold">Campaign brief</h2>
          <p className={`mb-4 text-sm ${muted}`}>Every word in the drafted posts comes from this brief and your product. Nothing is written by AI.</p>
          <CampaignBriefForm products={productRows.map((p) => ({ id: p.id, name: p.name }))} submitLabel="Create campaign" />
        </section>
      )}
    </main>
  );
}
