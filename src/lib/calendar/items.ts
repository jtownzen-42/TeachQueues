import "server-only";
// Calendar rows for one user: one per draft x channel that was sent (buffer_posts), plus one per
// local-only draft (no buffer_posts row). Injected db; every query is scoped by the user id.
import { and, eq, isNotNull, notExists, or } from "drizzle-orm";
import { bufferPosts, campaigns, drafts, lessons, products, type BufferChannel } from "@/db/schema";
import type { SendDb } from "@/lib/buffer/send";
import { networkForService } from "@/lib/buffer/posts";
import { NETWORK_LABELS } from "@/lib/lessons/templates";
import { calendarStatus, calendarTime, viewPostHref, type CalendarStatus } from "./status";

export const EXCERPT_CHARS = 100;

export type CalendarItem = {
  key: string;
  iso: string;
  timeLabel: "Due" | "Sent" | "Created";
  scheduled: boolean;
  status: CalendarStatus;
  network: string;
  channelName: string | null;
  source: { kind: "lesson" | "campaign"; label: string; href: string };
  excerpt: string;
  viewPost: string | null;
};

export function excerpt(text: string | null | undefined, n = EXCERPT_CHARS): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  const cps = [...t];
  return cps.length <= n ? t : cps.slice(0, n - 1).join("").trimEnd() + "…";
}

export async function loadCalendarItems(db: SendDb, userId: string, channels: BufferChannel[]): Promise<CalendarItem[]> {
  const draftCols = {
    draftId: drafts.id, draftStatus: drafts.status, perChannelText: drafts.perChannelText, createdAt: drafts.createdAt,
    lessonId: lessons.id, term: lessons.term, campaignId: campaigns.id, campaignName: campaigns.name,
  };
  // Lesson drafts must belong to the user's products; campaign drafts to the user's campaigns.
  const ownedSource = or(
    and(isNotNull(drafts.lessonId), eq(products.userId, userId)),
    and(isNotNull(drafts.campaignId), eq(campaigns.userId, userId)),
  );
  const sent = await db.select({ ...draftCols, post: bufferPosts }).from(bufferPosts)
    .innerJoin(drafts, eq(drafts.id, bufferPosts.draftId))
    .leftJoin(lessons, eq(lessons.id, drafts.lessonId))
    .leftJoin(products, eq(products.id, lessons.productId))
    .leftJoin(campaigns, eq(campaigns.id, drafts.campaignId))
    .where(and(eq(drafts.userId, userId), ownedSource));
  const local = await db.select(draftCols).from(drafts)
    .leftJoin(lessons, eq(lessons.id, drafts.lessonId))
    .leftJoin(products, eq(products.id, lessons.productId))
    .leftJoin(campaigns, eq(campaigns.id, drafts.campaignId))
    .where(and(
      eq(drafts.userId, userId), ownedSource,
      notExists(db.select({ id: bufferPosts.id }).from(bufferPosts).where(eq(bufferPosts.draftId, drafts.id))),
    ));

  const sourceOf = (r: { lessonId: string | null; term: string | null; campaignId: string | null; campaignName: string | null }) =>
    r.campaignId
      ? { kind: "campaign" as const, label: `Campaign: ${r.campaignName ?? ""}`, href: `/campaigns/${r.campaignId}#send` }
      : { kind: "lesson" as const, label: `Lesson: ${r.term ?? ""}`, href: `/lessons/${r.lessonId}#send` };
  const channelName = (id: string) => { const c = channels.find((x) => x.id === id); return c ? c.displayName || c.name : null; };

  const items: CalendarItem[] = [];
  for (const r of sent) {
    const p = r.post;
    const network = networkForService(p.service);
    const status = calendarStatus({ draftStatus: r.draftStatus, post: p });
    const t = calendarTime({ dueAt: p.dueAt, sentAt: p.sentAt, createdAt: r.createdAt });
    items.push({
      key: p.id, iso: t.iso, timeLabel: t.label, scheduled: t.scheduled, status,
      network: network ? NETWORK_LABELS[network] : p.service, channelName: channelName(p.channelId),
      source: sourceOf(r), excerpt: excerpt(network ? r.perChannelText?.[network] : null),
      viewPost: status.key === "sent" ? viewPostHref(p.externalLink) : null,
    });
  }
  for (const r of local) {
    const per = r.perChannelText ?? {};
    const text = per.linkedin ?? per.facebook ?? per.x ?? Object.values(per)[0];
    if (!text) continue; // nothing saved yet
    const t = calendarTime({ dueAt: null, sentAt: null, createdAt: r.createdAt });
    items.push({
      key: r.draftId, iso: t.iso, timeLabel: t.label, scheduled: false,
      status: calendarStatus({ draftStatus: r.draftStatus, post: null }),
      network: "Not sent yet", channelName: null, source: sourceOf(r), excerpt: excerpt(text), viewPost: null,
    });
  }
  return items;
}
