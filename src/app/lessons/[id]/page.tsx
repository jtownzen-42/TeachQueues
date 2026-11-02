import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users, type BufferChannel } from "@/db/schema";
import { getLatestLessonDraft, getLessonWithProduct, listLessonBufferPosts, parseId, requireUserId } from "@/lib/lessons/data";
import { channelErrorText, deskNoticesFrom, type Notice } from "@/lib/notices";
import { charCount, draftAll, FORMAT_LABELS, LIMITS, NETWORK_LABELS, NETWORKS, type DraftTexts } from "@/lib/lessons/templates";
import { getChannels } from "@/lib/buffer/sync";
import { networkForService } from "@/lib/buffer/posts";
import { isTestMode } from "@/lib/testmode";
import { safeTimeZone } from "@/lib/tz";
import { deleteLesson } from "@/app/products/actions";
import { DraftEditor } from "@/components/desk/DraftEditor";
import { LessonForm } from "@/components/desk/LessonForm";
import { SendPanel, type SendOption } from "@/components/desk/SendPanel";
import { SendStatus } from "@/components/desk/SendStatus";
import { card, Crumbs, DeleteDetails, muted, NoticeBox } from "@/components/desk/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lesson drafts · TeachQueue" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** A saved draft only counts if it has text for every network we draft. */
function savedTexts(per: Record<string, string> | null | undefined): DraftTexts | null {
  if (!per || !NETWORKS.every((n) => typeof per[n] === "string")) return null;
  return { x: per.x, facebook: per.facebook, linkedin: per.linkedin };
}

function serviceLabel(service: string): string {
  const n = networkForService(service);
  return n ? NETWORK_LABELS[n] : "Buffer";
}

/** Cached channels only (no forced Buffer request just to render the page). */
async function loadChannels(userId: string): Promise<{ channels: BufferChannel[]; error: string | null }> {
  try {
    return { channels: (await getChannels(userId)).channels, error: null };
  } catch (e) {
    return { channels: [], error: channelErrorText(e) };
  }
}

export default async function LessonPage({ params, searchParams }: Props) {
  const userId = await requireUserId();
  const [{ id: rawId }, sp] = await Promise.all([params, searchParams]);
  const id = parseId(rawId);
  if (!id) notFound();
  const row = await getLessonWithProduct(userId, id);
  if (!row) notFound();
  const { lesson, product } = row;
  const [draft, posts, [u]] = await Promise.all([
    getLatestLessonDraft(userId, lesson.id),
    listLessonBufferPosts(userId, lesson.id),
    getDb().select({ tz: users.tz, testMode: users.testMode, hasToken: sql<boolean>`${users.accessTokenEnc} is not null`, cached: users.channelsCache }).from(users).where(eq(users.id, userId)),
  ]);
  const tz = safeTimeZone(u?.tz);
  const now = new Date();

  // After a rejected send, show Buffer's own reason (already sanitized when stored) right under the
  // notice. The text comes from this user's buffer_posts row, never from the query string.
  const latestFailed = sp.n === "rejected"
    ? posts.map((r) => r.post).filter((p) => !p.bufferPostId && p.lastStatus === "failed" && p.error)
        .sort((a, b) => (b.checkedAt ?? b.createdAt).getTime() - (a.checkedAt ?? a.createdAt).getTime())[0]
    : undefined;
  const failureDetail: Notice | null = latestFailed?.error
    ? { kind: "error", text: `${serviceLabel(latestFailed.service)}: ${latestFailed.error}` }
    : null;

  const productFields = { name: product.name, url: product.url };
  const generated = draftAll(lesson, productFields);
  const saved = savedTexts(draft?.perChannelText);
  const sentVersion = draft?.status !== undefined && draft.status !== "draft";
  const created = draft ? new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(draft.createdAt) : "";
  const savedLabel = draft ? (sentVersion ? `sent version, created ${created}; saving changes makes a new version` : `created ${created}`) : null;

  // Send panel: only for a complete saved draft, and only channels we draft for.
  const { channels, error: channelError } = saved && u?.hasToken ? await loadChannels(userId) : { channels: [] as BufferChannel[], error: null };
  const options: SendOption[] = saved
    ? channels.flatMap((c) => {
        const n = networkForService(c.service);
        if (!n || c.isDisconnected || c.isLocked || !saved[n]?.trim()) return [];
        return [{ id: c.id, name: c.displayName || c.name, networkLabel: NETWORK_LABELS[n], text: saved[n], count: charCount(saved[n], n), limit: LIMITS[n] }];
      })
    : [];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 font-sans sm:px-8">
      <Crumbs items={[
        { href: "/", label: "TeachQueue" }, { href: "/products", label: "Products" },
        { href: `/products/${product.id}`, label: product.name }, { label: lesson.term },
      ]} />
      <h1 className="mt-2 break-words text-3xl font-bold">{lesson.term}</h1>
      <p className={`mt-1 text-sm ${muted}`}>{FORMAT_LABELS[lesson.format]} · for {product.name}</p>
      {deskNoticesFrom(sp).map((n, i) => <NoticeBox key={i} n={n} />)}
      {failureDetail && <NoticeBox n={failureDetail} />}

      <section className="mt-8" aria-labelledby="drafts-heading">
        <h2 id="drafts-heading" className="mb-4 text-xl font-semibold">Drafts</h2>
        {/* key: remount with fresh text when the lesson (and so the template copy) changes */}
        <DraftEditor
          key={`${lesson.id}:${JSON.stringify(generated)}`}
          lessonId={lesson.id} product={productFields} generated={generated} saved={saved} savedLabel={savedLabel}
        />
      </section>

      <section id="send" className="mt-10 scroll-mt-4" aria-labelledby="send-heading">
        <h2 id="send-heading" className="mb-4 text-xl font-semibold">Send to Buffer</h2>
        {!draft || !saved ? (
          <p className={`text-sm ${muted}`}>Save the draft above first. Then you can send it to one of your Buffer channels.</p>
        ) : !u?.hasToken ? (
          <p className="text-sm">Your Buffer connection has expired. <a href="/api/auth/login" className="underline">Connect with Buffer</a> to send drafts.</p>
        ) : (
          <>
            {channelError && <p role="alert" className="mb-3 text-sm text-red-700 dark:text-red-400">{channelError}</p>}
            {options.length === 0 ? (
              <p className={`text-sm ${muted}`}>No matching Buffer channels. Connect an X, Facebook or LinkedIn channel in Buffer, then use “Re-sync channels” on the home page.</p>
            ) : (
              <SendPanel
                lessonId={lesson.id} draftId={draft.id} tz={tz} tzLabel={tz.replace(/_/g, " ")}
                testMode={isTestMode(process.env.TEST_MODE, u.testMode)} options={options}
              />
            )}
          </>
        )}
        <h3 className="mb-2 mt-6 text-lg font-semibold">Sent to</h3>
        <SendStatus rows={posts} channels={channels.length ? channels : u?.cached ?? []} tz={tz} lessonId={lesson.id} currentDraftId={draft?.id ?? null} now={now} />
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
