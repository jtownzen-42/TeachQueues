// Server component: the 1080x1080 lesson graphic preview plus "Save image".
import { saveLessonImageAction } from "@/app/lessons/graphic-actions";
import { PendingButton } from "./PendingButton";
import { card, linkCls, muted } from "./ui";

export type SavedImageState =
  | { kind: "none" }
  | { kind: "current"; url: string; savedLabel: string }
  | { kind: "stale" };

export function LessonGraphic({ lessonId, draftId, hash, alt, saved }: {
  lessonId: string; draftId: string | null; hash: string; alt: string; saved: SavedImageState;
}) {
  return (
    <div className={`${card} space-y-4`}>
      {/* A plain <img>: this is a private, no-store, per-user PNG route, so next/image optimisation doesn't apply. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/lessons/${lessonId}/graphic?v=${hash.slice(0, 12)}`}
        alt={alt}
        width={1080}
        height={1080}
        className="aspect-square h-auto w-full max-w-full rounded border border-neutral-300 dark:border-neutral-700"
      />
      {saved.kind === "current" && (
        <p className="text-sm">
          <span>Saved image ✓ · {saved.savedLabel}</span>{" · "}
          <a href={saved.url} target="_blank" rel="noopener noreferrer" className={linkCls}>Open the saved PNG<span className="sr-only"> (opens in a new tab)</span></a>
        </p>
      )}
      {saved.kind === "stale" && (
        <p role="status" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          The saved image is out of date. Save it again to use the new version.
        </p>
      )}
      {draftId ? (
        <form action={saveLessonImageAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="lessonId" value={lessonId} />
          <input type="hidden" name="draftId" value={draftId} />
          <PendingButton label="Save image" pendingLabel="Saving image…" />
          <span className={`text-sm ${muted}`}>Saves a public PNG so it can be attached to your Buffer drafts.</span>
        </form>
      ) : (
        <p className={`text-sm ${muted}`}>Save the draft above first. Then you can save this image and attach it when you send.</p>
      )}
    </div>
  );
}
