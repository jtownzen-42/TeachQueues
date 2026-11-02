// Vercel Blob URL rules shared by "Save image", "Send to Buffer" and delete-my-data. Pure.

export const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

/** True only for https://<store>.public.blob.vercel-storage.com/... with no credentials. */
export function isPublicBlobUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 2048) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.toLowerCase();
  return u.protocol === "https:" && !u.username && !u.password && !u.port
    && host.endsWith(BLOB_HOST_SUFFIX) && host.length > BLOB_HOST_SUFFIX.length;
}

/** Blob pathname for a lesson graphic: teachqueue/lessons/<draftId>-<hash12>.png */
export function lessonImagePathname(draftId: string, hash: string): string {
  return `teachqueue/lessons/${draftId}-${hash.slice(0, 12)}.png`;
}

/** The draft's saved image URL, only if it is a valid Blob URL rendered from `currentHash`. */
export function currentImageUrl(draft: { imageUrl: string | null; imageHash: string | null }, currentHash: string): string | null {
  return draft.imageUrl && draft.imageHash === currentHash && isPublicBlobUrl(draft.imageUrl) ? draft.imageUrl : null;
}
