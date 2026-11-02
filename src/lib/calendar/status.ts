// Calendar status for one row (draft x channel, or a local-only draft). Pure and exhaustively tested.
import { sanitizeBufferMessage } from "@/lib/buffer/posts";

export type CalendarStatusKey =
  | "draft" | "approved" | "send_failed" | "sending_local"
  | "draft_in_buffer" | "awaiting_approval" | "scheduled" | "sending" | "sent" | "failed" | "not_found";

export const STATUS_LABELS: Record<CalendarStatusKey, string> = {
  draft: "Draft",
  approved: "Approved",
  send_failed: "Send failed",
  sending_local: "Sending to Buffer",
  draft_in_buffer: "Draft in Buffer",
  awaiting_approval: "Awaiting approval in Buffer",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  not_found: "Not found in Buffer",
};

/** Header counts, in this order. */
export const COUNTED_STATUSES: { key: CalendarStatusKey; label: string; also?: CalendarStatusKey[] }[] = [
  { key: "draft", label: "Draft" },
  { key: "approved", label: "Approved" },
  { key: "draft_in_buffer", label: "Draft in Buffer" },
  { key: "scheduled", label: "Scheduled" },
  { key: "sent", label: "Sent" },
  { key: "failed", label: "Failed", also: ["send_failed"] },
];

export type StatusInput = {
  /** Draft row status (draft | approved | queued). */
  draftStatus: string;
  /** null for a local-only draft (no buffer_posts row). */
  post: null | {
    bufferPostId: string | null;
    lastStatus: string | null;
    error: string | null;
    bufferStatus: string | null;
    bufferError: string | null;
    bufferMissingAt: Date | null;
  };
};

export type CalendarStatus = { key: CalendarStatusKey; label: string; detail?: string };

const BUFFER_MAP: Record<string, CalendarStatusKey> = {
  draft: "draft_in_buffer", needs_approval: "awaiting_approval", scheduled: "scheduled", sending: "sending", sent: "sent", error: "failed",
};

export function calendarStatus(row: StatusInput): CalendarStatus {
  const s = (key: CalendarStatusKey, detail?: string): CalendarStatus => (detail ? { key, label: STATUS_LABELS[key], detail } : { key, label: STATUS_LABELS[key] });
  const p = row.post;
  if (!p) return s(row.draftStatus === "approved" ? "approved" : "draft");
  if (!p.bufferPostId) {
    // Our own send claim: failed, or still in flight.
    if (p.lastStatus === "sending" && !p.error) return s("sending_local");
    return s("send_failed", p.error ?? undefined);
  }
  if (p.bufferMissingAt) return s("not_found", "Deleted in Buffer or too old to read back.");
  const key = p.bufferStatus ? BUFFER_MAP[p.bufferStatus] : undefined;
  if (key === "failed") return s("failed", p.bufferError ? sanitizeBufferMessage(p.bufferError) : undefined);
  if (key) return s(key);
  // Sent but never read back: our send creates a Buffer draft (last_status "draft").
  return s("draft_in_buffer");
}

export type TimeChoice = { iso: string; label: "Due" | "Sent" | "Created"; scheduled: boolean };

/** Buffer dueAt (stored in due_at by the read-back) / our requested due_at -> "Due"; sentAt -> "Sent";
 *  else the draft's created_at -> "Created" (unscheduled). */
export function calendarTime(t: { dueAt: Date | null; sentAt: Date | null; createdAt: Date }): TimeChoice {
  if (t.dueAt) return { iso: t.dueAt.toISOString(), label: "Due", scheduled: true };
  if (t.sentAt) return { iso: t.sentAt.toISOString(), label: "Sent", scheduled: true };
  return { iso: t.createdAt.toISOString(), label: "Created", scheduled: false };
}

/** "View post" only for an https link. */
export function viewPostHref(link: string | null | undefined): string | null {
  if (!link || typeof link !== "string") return null;
  try {
    const u = new URL(link);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}
