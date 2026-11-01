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
};

export function deskNoticesFrom(sp: Record<string, string | string[] | undefined>): Notice[] {
  const n = one(sp.n);
  return n && DESK[n] ? [DESK[n]] : [];
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
