"use server";
// Lesson desk Server Actions. Every action: Origin check -> session -> zod -> user-scoped query.
// Nothing here talks to Buffer.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { drafts, lessons, products } from "@/db/schema";
import {
  deleteLessonTree, deleteProductTree, getLessonDraft, getLessonWithProduct, getProduct,
  parseId, pgCode, requestIsSameOrigin, requireUserId,
} from "@/lib/lessons/data";
import { draftInput, DRAFT_FIELDS, fieldErrors, formFields, lessonInput, productInput, type FieldErrors } from "@/lib/lessons/validation";
import { draftProblems, NETWORKS, type DraftTexts } from "@/lib/lessons/templates";

export type FormState = {
  /** Bumps on every response so the client form remounts with `values`. */
  nonce: number;
  error?: string;
  fields?: FieldErrors;
  values?: Record<string, string | undefined>;
  ok?: string;
};

const PRODUCT_FIELDS = ["name", "url", "brandColor"] as const;
const LESSON_FIELDS = ["term", "definition", "example", "format"] as const;
const FORBIDDEN = "That request came from another site, so it was ignored.";
const NOT_FOUND = "That item doesn't exist or isn't yours.";
const FAILED = "Something went wrong saving that. Please try again.";

function fail(prev: FormState, values: FormState["values"], extra: Partial<FormState>): FormState {
  return { nonce: prev.nonce + 1, values, ...extra };
}

// ---------- Products ----------

export async function saveProduct(prev: FormState, fd: FormData): Promise<FormState> {
  const values = formFields(fd, PRODUCT_FIELDS);
  if (!(await requestIsSameOrigin())) return fail(prev, values, { error: FORBIDDEN });
  const userId = await requireUserId();
  const rawId = fd.get("productId");
  const productId = rawId ? parseId(rawId) : null;
  if (rawId && !productId) return fail(prev, values, { error: NOT_FOUND });

  const parsed = productInput.safeParse(values);
  if (!parsed.success) return fail(prev, values, { error: "Please fix the highlighted fields.", fields: fieldErrors(parsed.error) });
  const { name, url, brandColor } = parsed.data;

  let id: string;
  try {
    if (productId) {
      const existing = await getProduct(userId, productId);
      if (!existing) return fail(prev, values, { error: NOT_FOUND });
      // Keep any extra palette colors; the first one is the brand color.
      const rest = (existing.brandColors ?? []).slice(1).filter((c) => c !== brandColor);
      await getDb().update(products).set({ name, url, brandColors: [brandColor, ...rest] })
        .where(and(eq(products.id, productId), eq(products.userId, userId)));
      id = productId;
    } else {
      const [row] = await getDb().insert(products).values({ userId, name, url, brandColors: [brandColor] }).returning({ id: products.id });
      id = row.id;
    }
  } catch (e) {
    console.error("[teachqueue] save product failed", pgCode(e) ?? (e as Error).message);
    return fail(prev, values, { error: FAILED });
  }
  revalidatePath("/products");
  redirect(`/products/${id}?n=${productId ? "product_saved" : "product_created"}`);
}

export async function deleteProduct(fd: FormData): Promise<void> {
  if (!(await requestIsSameOrigin())) redirect("/products?n=forbidden");
  const userId = await requireUserId();
  const productId = parseId(fd.get("productId"));
  if (!productId) redirect("/products?n=not_found");
  let result: Awaited<ReturnType<typeof deleteProductTree>>;
  try {
    result = await deleteProductTree(userId, productId);
  } catch (e) {
    const code = pgCode(e);
    console.error("[teachqueue] delete product failed", code ?? (e as Error).message);
    if (code !== "23503") redirect(`/products/${productId}?n=error`); // 23503 = still referenced
    result = "in_use";
  }
  if (result === "in_use") redirect(`/products/${productId}?n=product_in_use`);
  if (result === "not_found") redirect("/products?n=not_found");
  revalidatePath("/products");
  redirect("/products?n=product_deleted");
}

// ---------- Lessons ----------

export async function saveLesson(prev: FormState, fd: FormData): Promise<FormState> {
  const values = formFields(fd, LESSON_FIELDS);
  if (!(await requestIsSameOrigin())) return fail(prev, values, { error: FORBIDDEN });
  const userId = await requireUserId();
  const rawLessonId = fd.get("lessonId");
  const lessonId = rawLessonId ? parseId(rawLessonId) : null;
  const productId = parseId(fd.get("productId"));
  if ((rawLessonId && !lessonId) || (!rawLessonId && !productId)) return fail(prev, values, { error: NOT_FOUND });

  const parsed = lessonInput.safeParse(values);
  if (!parsed.success) return fail(prev, values, { error: "Please fix the highlighted fields.", fields: fieldErrors(parsed.error) });

  let id: string;
  try {
    if (lessonId) {
      const owned = getDb().select({ id: products.id }).from(products).where(eq(products.userId, userId));
      const updated = await getDb().update(lessons).set(parsed.data)
        .where(and(eq(lessons.id, lessonId), inArray(lessons.productId, owned)))
        .returning({ id: lessons.id });
      if (updated.length === 0) return fail(prev, values, { error: NOT_FOUND });
      id = lessonId;
    } else {
      if (!(await getProduct(userId, productId!))) return fail(prev, values, { error: NOT_FOUND });
      const [row] = await getDb().insert(lessons).values({ ...parsed.data, productId: productId! }).returning({ id: lessons.id });
      id = row.id;
    }
  } catch (e) {
    console.error("[teachqueue] save lesson failed", pgCode(e) ?? (e as Error).message);
    return fail(prev, values, { error: FAILED });
  }
  revalidatePath("/products");
  redirect(`/lessons/${id}?n=${lessonId ? "lesson_saved" : "lesson_created"}`);
}

export async function deleteLesson(fd: FormData): Promise<void> {
  if (!(await requestIsSameOrigin())) redirect("/products?n=forbidden");
  const userId = await requireUserId();
  const lessonId = parseId(fd.get("lessonId"));
  if (!lessonId) redirect("/products?n=not_found");
  let out: Awaited<ReturnType<typeof deleteLessonTree>>;
  try {
    out = await deleteLessonTree(userId, lessonId);
  } catch (e) {
    console.error("[teachqueue] delete lesson failed", pgCode(e) ?? (e as Error).message);
    redirect(`/lessons/${lessonId}?n=error`);
  }
  if (out.result === "not_found") redirect("/products?n=not_found");
  if (out.result === "in_use") redirect(`/lessons/${lessonId}?n=lesson_in_use`);
  revalidatePath("/products");
  redirect(`/products/${out.productId}?n=lesson_deleted`);
}

// ---------- Drafts (saved locally only; Buffer comes in the next task) ----------

export async function saveDraft(prev: FormState, fd: FormData): Promise<FormState> {
  const values = formFields(fd, DRAFT_FIELDS);
  if (!(await requestIsSameOrigin())) return fail(prev, values, { error: FORBIDDEN });
  const userId = await requireUserId();
  const parsed = draftInput.safeParse(values);
  if (!parsed.success) return fail(prev, values, { error: "Please fix the highlighted drafts.", fields: fieldErrors(parsed.error) });

  const owned = await getLessonWithProduct(userId, parsed.data.lessonId);
  if (!owned) return fail(prev, values, { error: NOT_FOUND });
  const texts: DraftTexts = { x: parsed.data.x, facebook: parsed.data.facebook, linkedin: parsed.data.linkedin };
  const problems = draftProblems(texts, owned.product);
  if (Object.keys(problems).length > 0) {
    return fail(prev, values, { error: "Please fix the highlighted drafts.", fields: problems as FieldErrors });
  }

  try {
    const perChannelText: Record<string, string> = Object.fromEntries(NETWORKS.map((n) => [n, texts[n]]));
    const existing = await getLessonDraft(userId, owned.lesson.id);
    if (existing) {
      await getDb().update(drafts).set({ perChannelText })
        .where(and(eq(drafts.id, existing.id), eq(drafts.userId, userId), eq(drafts.status, "draft")));
    } else {
      await getDb().insert(drafts).values({ userId, lessonId: owned.lesson.id, perChannelText, status: "draft" });
    }
  } catch (e) {
    console.error("[teachqueue] save draft failed", pgCode(e) ?? (e as Error).message);
    return fail(prev, values, { error: FAILED });
  }
  revalidatePath(`/lessons/${owned.lesson.id}`);
  return { nonce: prev.nonce + 1, values, ok: "Draft saved. Nothing was sent to Buffer." };
}
