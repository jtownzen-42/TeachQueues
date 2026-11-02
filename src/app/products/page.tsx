import type { Metadata } from "next";
import Link from "next/link";
import { listProducts, primaryColor, requireUserId } from "@/lib/lessons/data";
import { deskNoticesFrom } from "@/lib/notices";
import { ProductForm } from "@/components/desk/ProductForm";
import { card, Crumbs, linkCls, muted, NoticeBox, Swatch } from "@/components/desk/ui";
import { LoadSamplesForm, RemoveSamplesDetails, SampleBadge } from "@/components/desk/Onboarding";
import { SAMPLE_NOTE } from "@/lib/onboarding/samples";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Products · TeachQueue" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const userId = await requireUserId();
  const [sp, items] = await Promise.all([searchParams, listProducts(userId)]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 font-sans sm:px-8">
      <Crumbs items={[{ href: "/", label: "TeachQueue" }, { label: "Products" }]} />
      <h1 className="mt-2 text-3xl font-bold">Lesson desk</h1>
      <p className={`mt-2 ${muted}`}>Add the products you sell, then write short lessons that teach something useful and point back to them.</p>
      {deskNoticesFrom(sp).map((n, i) => <NoticeBox key={i} n={n} />)}

      <section className="mt-8" aria-labelledby="products-heading">
        <h2 id="products-heading" className="text-xl font-semibold">Your products</h2>
        {items.length === 0 ? (
          <div className="mt-3 space-y-3">
            <p className={muted}>No products yet. Add your first one below, or load two sample products to see how it works.</p>
            <LoadSamplesForm back="/products" prominent />
          </div>
        ) : (
          <ul className="mt-3 divide-y rounded border border-neutral-300 dark:divide-neutral-700 dark:border-neutral-700">
            {items.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3">
                <span className="flex min-w-0 items-center gap-2">
                  <Swatch color={primaryColor(p)} />
                  <Link href={`/products/${p.id}`} className={`min-w-0 break-words font-medium ${linkCls}`}>{p.name}</Link>
                  {p.isSample && <SampleBadge />}
                </span>
                <span className={`text-sm ${muted}`}>{p.lessonCount} {p.lessonCount === 1 ? "lesson" : "lessons"}</span>
                <span className={`w-full break-all text-sm ${muted}`}>{p.url}</span>
              </li>
            ))}
          </ul>
        )}
        {items.some((p) => p.isSample) && (
          <div className="mt-3 space-y-3">
            <p className={`text-sm ${muted}`}>{SAMPLE_NOTE}</p>
            <RemoveSamplesDetails back="/products" />
          </div>
        )}
        {items.length > 0 && !items.some((p) => p.isSample) && (
          <p className="mt-3 flex flex-wrap items-center gap-3 text-sm"><LoadSamplesForm back="/products" /></p>
        )}
      </section>

      <section className={`mt-8 ${card}`} aria-labelledby="add-product-heading">
        <h2 id="add-product-heading" className="mb-4 text-xl font-semibold">Add a product</h2>
        <ProductForm submitLabel="Add product" />
      </section>
    </main>
  );
}
