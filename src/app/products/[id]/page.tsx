import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, listLessons, parseId, primaryColor, requireUserId } from "@/lib/lessons/data";
import { deskNoticesFrom } from "@/lib/notices";
import { FORMAT_LABELS } from "@/lib/lessons/templates";
import { deleteProduct } from "../actions";
import { ProductForm } from "@/components/desk/ProductForm";
import { LessonForm } from "@/components/desk/LessonForm";
import { card, Crumbs, DeleteDetails, linkCls, muted, NoticeBox, Swatch } from "@/components/desk/ui";
import { SampleBadge } from "@/components/desk/Onboarding";
import { SAMPLE_NOTE } from "@/lib/onboarding/samples";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Product · TeachQueue" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ProductPage({ params, searchParams }: Props) {
  const userId = await requireUserId();
  const [{ id: rawId }, sp] = await Promise.all([params, searchParams]);
  const id = parseId(rawId);
  if (!id) notFound();
  const product = await getProduct(userId, id);
  if (!product) notFound();
  const items = await listLessons(userId, id);
  const color = primaryColor(product);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 font-sans sm:px-8">
      <Crumbs items={[{ href: "/", label: "TeachQueue" }, { href: "/products", label: "Products" }, { label: product.name }]} />
      <h1 className="mt-2 flex items-center gap-3 break-words text-3xl font-bold"><Swatch color={color} />{product.name}{product.isSample && <SampleBadge />}</h1>
      <p className={`mt-1 break-all text-sm ${muted}`}>{product.url}</p>
      {product.isSample && <p className={`mt-1 text-sm ${muted}`}>{SAMPLE_NOTE}</p>}
      {deskNoticesFrom(sp).map((n, i) => <NoticeBox key={i} n={n} />)}

      <section className="mt-8" aria-labelledby="lessons-heading">
        <h2 id="lessons-heading" className="text-xl font-semibold">Lessons</h2>
        {items.length === 0 ? (
          <p className={`mt-3 ${muted}`}>No lessons yet. Add a short lesson below: a term, a common misconception, or a prompt demonstration.</p>
        ) : (
          <ul className="mt-3 divide-y rounded border border-neutral-300 dark:divide-neutral-700 dark:border-neutral-700">
            {items.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3">
                <Link href={`/lessons/${l.id}`} className={`min-w-0 break-words font-medium ${linkCls}`}>{l.term}</Link>
                <span className={`text-sm ${muted}`}>{FORMAT_LABELS[l.format]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`mt-8 ${card}`} aria-labelledby="add-lesson-heading">
        <h2 id="add-lesson-heading" className="mb-4 text-xl font-semibold">Add a lesson</h2>
        <LessonForm initial={{ productId: product.id }} submitLabel="Add lesson" />
      </section>

      <section className={`mt-8 ${card}`} aria-labelledby="edit-product-heading">
        <h2 id="edit-product-heading" className="mb-4 text-xl font-semibold">Edit product</h2>
        <ProductForm initial={{ id: product.id, name: product.name, url: product.url, brandColor: color }} submitLabel="Save product" />
      </section>

      <div className="mt-8">
        <DeleteDetails
          summary="Delete product"
          warning={`This deletes "${product.name}", its ${items.length} ${items.length === 1 ? "lesson" : "lessons"} and their unsent drafts.`}
          action={deleteProduct}
          hidden={{ productId: product.id }}
        />
      </div>
    </main>
  );
}
