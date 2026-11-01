import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getLessonDraft, getLessonWithProduct, parseId, requireUserId } from "@/lib/lessons/data";
import { deskNoticesFrom } from "@/lib/notices";
import { draftAll, FORMAT_LABELS, NETWORKS, type DraftTexts } from "@/lib/lessons/templates";
import { safeTimeZone } from "@/lib/tz";
import { deleteLesson } from "@/app/products/actions";
import { DraftEditor } from "@/components/desk/DraftEditor";
import { LessonForm } from "@/components/desk/LessonForm";
import { card, Crumbs, DeleteDetails, muted, NoticeBox } from "@/components/desk/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lesson drafts · TeachQueue" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** A saved draft only counts if it has text for every network we draft. */
function savedTexts(per: Record<string, string> | null | undefined): DraftTexts | null {
  if (!per || !NETWORKS.every((n) => typeof per[n] === "string")) return null;
  return { x: per.x, facebook: per.facebook, linkedin: per.linkedin };
}

export default async function LessonPage({ params, searchParams }: Props) {
  const userId = await requireUserId();
  const [{ id: rawId }, sp] = await Promise.all([params, searchParams]);
  const id = parseId(rawId);
  if (!id) notFound();
  const row = await getLessonWithProduct(userId, id);
  if (!row) notFound();
  const { lesson, product } = row;
  const [draft, [u]] = await Promise.all([
    getLessonDraft(userId, lesson.id),
    getDb().select({ tz: users.tz }).from(users).where(eq(users.id, userId)),
  ]);

  const productFields = { name: product.name, url: product.url };
  const generated = draftAll(lesson, productFields);
  const saved = savedTexts(draft?.perChannelText);
  const savedLabel = draft
    ? `created ${new Intl.DateTimeFormat("en-US", { timeZone: safeTimeZone(u?.tz), dateStyle: "medium", timeStyle: "short" }).format(draft.createdAt)}`
    : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 font-sans sm:px-8">
      <Crumbs items={[
        { href: "/", label: "TeachQueue" }, { href: "/products", label: "Products" },
        { href: `/products/${product.id}`, label: product.name }, { label: lesson.term },
      ]} />
      <h1 className="mt-2 break-words text-3xl font-bold">{lesson.term}</h1>
      <p className={`mt-1 text-sm ${muted}`}>{FORMAT_LABELS[lesson.format]} · for {product.name}</p>
      {deskNoticesFrom(sp).map((n, i) => <NoticeBox key={i} n={n} />)}

      <section className="mt-8" aria-labelledby="drafts-heading">
        <h2 id="drafts-heading" className="mb-4 text-xl font-semibold">Drafts</h2>
        {/* key: remount with fresh text when the lesson (and so the template copy) changes */}
        <DraftEditor
          key={`${lesson.id}:${JSON.stringify(generated)}`}
          lessonId={lesson.id} product={productFields} generated={generated} saved={saved} savedLabel={savedLabel}
        />
      </section>

      <section className={`mt-10 ${card}`} aria-labelledby="edit-lesson-heading">
        <h2 id="edit-lesson-heading" className="mb-4 text-xl font-semibold">Edit lesson</h2>
        <LessonForm
          initial={{ id: lesson.id, term: lesson.term, definition: lesson.definition, example: lesson.example, format: lesson.format }}
          submitLabel="Save lesson"
        />
      </section>

      <div className="mt-8">
        <DeleteDetails summary="Delete lesson" warning={`This deletes "${lesson.term}" and its unsent drafts.`} action={deleteLesson} hidden={{ lessonId: lesson.id }} />
      </div>
    </main>
  );
}
