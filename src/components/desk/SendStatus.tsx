// Server component: one line per draft x channel this lesson was sent to.
import type { BufferChannel } from "@/db/schema";
import type { bufferPosts } from "@/db/schema";
import { sendToBuffer } from "@/app/lessons/actions";
import { retryState } from "@/lib/buffer/send";
import { utcToLocalInput } from "@/lib/buffer/schedule";
import { formatInZone } from "@/lib/tz";
import { btn, muted } from "./ui";

type Row = { post: typeof bufferPosts.$inferSelect; draftId: string };

export function SendStatus({ rows, channels, tz, lessonId, currentDraftId, now }: {
  rows: Row[]; channels: BufferChannel[]; tz: string; lessonId: string; currentDraftId: string | null; now: Date;
}) {
  if (rows.length === 0) return <p className={`text-sm ${muted}`}>Not sent to Buffer yet.</p>;
  const nameOf = (id: string) => {
    const c = channels.find((x) => x.id === id);
    return c ? (c.displayName || c.name) : "Channel no longer connected";
  };
  const when = (d: Date | null) => {
    if (!d) return "Queue (Buffer picks the slot)";
    const iso = d.toISOString();
    return `${formatInZone(iso, tz)} · ${iso} UTC`;
  };

  return (
    <ul className="divide-y rounded border border-neutral-300 dark:divide-neutral-700 dark:border-neutral-700">
      {rows.map(({ post: p, draftId }) => {
        const state = retryState(p, now);
        const older = currentDraftId !== null && draftId !== currentDraftId;
        return (
          <li key={p.id} className="space-y-1 p-3 text-sm">
            {state === "done" ? (
              <p className="break-words">
                <strong>Sent to Buffer as draft</strong> · {nameOf(p.channelId)} · {when(p.dueAt)} · Buffer post id{" "}
                <code className="break-all">{p.bufferPostId}</code>
              </p>
            ) : state === "sending" ? (
              <p><strong>Sending…</strong> · {nameOf(p.channelId)}</p>
            ) : (
              <p role="status" className="break-words">
                <strong className="text-red-700 dark:text-red-400">Failed</strong> · {nameOf(p.channelId)} · {p.error || "Couldn't reach Buffer. Nothing was posted."}
              </p>
            )}
            <p className={muted}>
              {older ? "Earlier version of this draft · " : ""}Sent {formatInZone(p.createdAt.toISOString(), tz)}
              {p.checkedAt ? ` · retried ${formatInZone(p.checkedAt.toISOString(), tz)}` : ""}
            </p>
            {state === "retry" && (
              <form action={sendToBuffer}>
                <input type="hidden" name="lessonId" value={lessonId} />
                <input type="hidden" name="draftId" value={draftId} />
                <input type="hidden" name="channelId" value={p.channelId} />
                <input type="hidden" name="mode" value={p.dueAt ? "custom" : "queue"} />
                {p.dueAt && <input type="hidden" name="local" value={utcToLocalInput(p.dueAt.toISOString(), tz)} />}
                <button type="submit" className={`${btn} mt-1`}>Retry</button>
              </form>
            )}
            {state === "tomorrow" && <p className={muted}>Already retried today. You can retry again tomorrow.</p>}
          </li>
        );
      })}
    </ul>
  );
}
