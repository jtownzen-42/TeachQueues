import { SEND_ERROR_TEXT } from "./buffer/posts";
import { DUE_AT_ERROR_TEXT } from "./buffer/schedule";
import { IMAGE_SAVE_LIMIT_PER_DAY } from "./graphics/limits";

// Fixed, human-readable banners for the home page. Only known codes are shown, so
// query strings can't put arbitrary text on the page.

export type Notice = { kind: "error" | "info"; text: string };

const AUTH_ERRORS: Record<string, string> = {
  denied: "You cancelled the Buffer consent screen. Nothing was connected.",
  state: "That sign-in link expired or was opened in another browser. Please try again.",
  invalid_grant: "Buffer said the sign-in code was already used or expired. Please try again.",
  invalid_client: "Buffer didn't recognise this app's client. (Check the client ID and secret.)",
  missing_code: "Buffer didn't send a sign-in code back. Please try again.",
  buffer: "Buffer reported a problem during sign-in. Please try again.",
  exchange_failed: "Connecting to Buffer failed. Please try again in a minute.",
};

const SYNC: Record<string, Notice> = {
  ok: { kind: "info", text: "Channels re-synced from Buffer." },
  cooldown: { kind: "info", text: "Channels were synced less than a minute ago, so we showed the saved list. Try again in a minute." },
  busy: { kind: "error", text: "Buffer is busy right now (rate limited). Your saved channel list is shown; try again shortly." },
  reconnect: { kind: "error", text: "Your Buffer connection has expired. Please connect again." },
  error: { kind: "error", text: "Couldn't reach Buffer to re-sync channels. Your saved list is shown; try again shortly." },
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function noticesFrom(sp: Record<string, string | string[] | undefined>): Notice[] {
  const out: Notice[] = [];
  const auth = one(sp.auth_error);
  if (auth) {
    out.push({ kind: "error", text: AUTH_ERRORS[auth] ?? (auth.startsWith("http_") ? AUTH_ERRORS.exchange_failed : "Connecting to Buffer failed. Please try again.") });
  }
  const sync = one(sp.sync);
  if (sync && SYNC[sync]) out.push(SYNC[sync]);
  if (one(sp.connected)) out.push({ kind: "info", text: "Connected to Buffer." });
  if (one(sp.deleted)) out.push({ kind: "info", text: "Deleted. TeachQueue removed your account and everything it stored for you." });
  else if (one(sp.disconnected)) out.push({ kind: "info", text: "Disconnected. TeachQueue no longer holds your Buffer tokens." });
  if (one(sp.expired)) out.push(SYNC.reconnect);
  return out;
}

// Lesson desk banners (/products, /products/[id], /lessons/[id]) come from ?n=<code>.
const DESK: Record<string, Notice> = {
  product_created: { kind: "info", text: "Product added." },
  product_saved: { kind: "info", text: "Product saved." },
  product_deleted: { kind: "info", text: "Product and its lessons deleted." },
  product_in_use: { kind: "error", text: "This product is used by a campaign or an approved or queued post, so it can't be deleted yet." },
  lesson_created: { kind: "info", text: "Lesson added. Review the drafted copy below." },
  lesson_saved: { kind: "info", text: "Lesson saved. Use “Redraft from lesson” to refresh the copy." },
  lesson_deleted: { kind: "info", text: "Lesson deleted." },
  lesson_in_use: { kind: "error", text: "This lesson has an approved or queued post, so it can't be deleted yet." },
  draft_saved: { kind: "info", text: "Draft saved. Nothing was sent to Buffer." },
  not_found: { kind: "error", text: "That item doesn't exist or isn't yours." },
  forbidden: { kind: "error", text: "That request came from another site, so it was ignored." },
  error: { kind: "error", text: "Something went wrong saving that. Please try again." },
  // Send to Buffer (task 02)
  sent: { kind: "info", text: "Sent to Buffer as a draft. It won't publish until you schedule it in Buffer." },
  already_sent: { kind: "info", text: "This draft was already sent to that channel, so nothing new was sent." },
  confirm_another: { kind: "error", text: "An earlier version of this lesson is already in Buffer on that channel. Nothing was sent. To make a second Buffer draft, tick \u201cYes, send another copy\u201d and send again." },
  retry_later: { kind: "error", text: "That send already failed and was retried in the last 24 hours. To keep the shared Buffer quota fair, you can retry it again tomorrow." },
  send_limit: { kind: "error", text: "You've sent 20 posts to Buffer today. To keep the shared Buffer quota fair for everyone, try again tomorrow." },
  busy: { kind: "error", text: "Buffer is busy right now. Nothing was posted. Try again in a few minutes." },
  reconnect: { kind: "error", text: SEND_ERROR_TEXT.reconnect },
  rejected: { kind: "error", text: "Buffer didn't accept the post. The status below says why." },
  buffer_error: { kind: "error", text: SEND_ERROR_TEXT.buffer_error },
  network: { kind: "error", text: SEND_ERROR_TEXT.network },
  test_mode: { kind: "error", text: SEND_ERROR_TEXT.test_mode },
  draft_invalid: { kind: "error", text: "That network's text is over its character limit. Fix it and save the draft first." },
  time_invalid: { kind: "error", text: DUE_AT_ERROR_TEXT.time_invalid },
  time_gap: { kind: "error", text: DUE_AT_ERROR_TEXT.time_gap },
  time_past: { kind: "error", text: DUE_AT_ERROR_TEXT.time_past },
  time_far: { kind: "error", text: DUE_AT_ERROR_TEXT.time_far },
  // Lesson graphic (task 03)
  image_saved: { kind: "info", text: "Image saved. It will be attached when you send with \u201cAttach the saved image\u201d ticked." },
  image_limit: { kind: "error", text: `You've saved ${IMAGE_SAVE_LIMIT_PER_DAY} images today. To keep things fair for everyone, try again tomorrow.` },
  image_failed: { kind: "error", text: "Couldn't save the image. Nothing was changed. Try again shortly." },
  image_storage_off: { kind: "error", text: "Image storage isn't set up yet, so the image wasn't saved. The preview above still works, and you can still send text-only drafts." },
  // Marketing desk (task 04)
  campaign_created: { kind: "info", text: "Campaign created. Template copy with tracking links is ready below." },
  campaign_saved: { kind: "info", text: "Campaign brief saved. If the links or creative changed, review the copy and approve again." },
  campaign_deleted: { kind: "info", text: "Campaign deleted." },
  campaign_in_use: { kind: "error", text: "This campaign has an approved or sent version, so it can't be deleted." },
  variants_invalid: { kind: "error", text: "Some variants need fixing before they can be saved or approved. See the notes under each one." },
  checks_required: { kind: "error", text: "Tick both checks to approve this exact version." },
  approval_changed: { kind: "error", text: "Something changed since this page loaded. Review the copy again, then approve." },
  approved: { kind: "info", text: "Approved. This exact version can now be sent to Buffer as drafts." },
  not_approved: { kind: "error", text: "Approve the exact version first. Nothing was sent." },
  no_product: { kind: "error", text: "Pick one of your products." },
  // Calendar read-back + Results (task 05)
  read_ok: { kind: "info", text: "Statuses updated from Buffer." },
  read_partial: { kind: "info", text: "Statuses updated from Buffer for most posts. Some weren't read this time; they'll be checked on the next refresh." },
  nothing_to_read: { kind: "info", text: "Nothing to read from Buffer yet. Send a draft to Buffer first." },
  refresh_cooldown: { kind: "info", text: "Statuses were read less than a minute ago. Try again in a minute." },
  quota_low: { kind: "error", text: "Buffer's shared request budget is running low, so live refresh is paused for now. Your saved statuses are shown." },
  read_failed: { kind: "error", text: "Couldn't read statuses from Buffer. Your saved statuses are shown." },
  result_saved: { kind: "info", text: "Day saved." },
  result_deleted: { kind: "info", text: "Day deleted." },
  result_invalid: { kind: "error", text: "Some numbers need fixing. See the notes in the form." },
  image_unreachable: { kind: "error", text: "The saved image couldn't be reached, so nothing was sent to Buffer. Save the image again, then retry." },
};

export function deskNoticesFrom(sp: Record<string, string | string[] | undefined>): Notice[] {
  const n = one(sp.n);
  if (!n || !DESK[n]) return [];
  // busy may carry ?wait=<minutes>: digits only, clamped, so no arbitrary text reaches the page.
  const wait = one(sp.wait);
  if (n === "busy" && wait && /^\d{1,4}$/.test(wait)) {
    const m = Math.min(Math.max(Number(wait), 1), 1440);
    return [{ kind: "error", text: `Buffer is busy right now. Nothing was posted. Try again in ${m} min.` }];
  }
  return [DESK[n]];
}

export function deskNotice(code: keyof typeof DESK | string): Notice {
  return DESK[code] ?? DESK.error;
}

/** Friendly text for a channel load failure (never raw upstream messages). */
export function channelErrorText(e: unknown): string {
  const name = (e as { name?: string })?.name;
  const status = (e as { status?: number })?.status;
  if (name === "ReconnectRequired") return SYNC.reconnect.text;
  if (status === 429) return SYNC.busy.text;
  return "Couldn't load channels from Buffer just now. Showing the saved list.";
}
