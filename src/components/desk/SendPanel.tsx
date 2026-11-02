"use client";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { sendToBuffer } from "@/app/lessons/actions";
import { DUE_AT_ERROR_TEXT, dueAtPreview, resolveDueAt } from "@/lib/buffer/schedule";
import { btn, card, fieldError, input, label, muted, primary } from "./ui";

export type SendOption = {
  id: string; name: string; networkLabel: string; text: string; count: number; limit: number;
  /** When an earlier version of this lesson already reached Buffer on this channel (display text). */
  priorSentLabel?: string | null;
};

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={primary} disabled={disabled || pending} aria-disabled={disabled || pending}>
      {pending ? "Sending…" : "Send to Buffer as draft"}
    </button>
  );
}

export function SendPanel({ lessonId, draftId, tz, tzLabel, testMode, options }: {
  lessonId: string; draftId: string; tz: string; tzLabel: string; testMode: boolean; options: SendOption[];
}) {
  const [channelId, setChannelId] = useState(options[0]?.id ?? "");
  const [mode, setMode] = useState<"queue" | "custom">("queue");
  const [local, setLocal] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const chosen = options.find((o) => o.id === channelId) ?? options[0];
  // Preview only. The server recomputes UTC from the wall-clock value on submit.
  const due = useMemo(() => (mode === "custom" && local ? resolveDueAt(local, tz, new Date()) : null), [mode, local, tz]);
  const timeBlocked = mode === "custom" && (!local || (due !== null && !due.ok));
  const needsConfirm = Boolean(chosen?.priorSentLabel);

  return (
    <form action={sendToBuffer} className={`${card} space-y-4`}>
      <input type="hidden" name="lessonId" value={lessonId} />
      <input type="hidden" name="draftId" value={draftId} />
      <p className="text-sm">
        {testMode ? <><strong>Test mode: ON (drafts only).</strong> </> : null}
        This always saves the post in Buffer as a <strong>draft</strong>. Nothing publishes until you schedule it in Buffer.
      </p>

      <div>
        <label htmlFor="send-channel" className={label}>Buffer channel</label>
        <select id="send-channel" name="channelId" value={chosen?.id ?? ""} onChange={(e) => { setChannelId(e.target.value); setConfirmed(false); }} className={input}>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.networkLabel})</option>)}
        </select>
      </div>

      {chosen && (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className={label} id="send-preview-h">Text that will be sent ({chosen.networkLabel})</h3>
            <span className={`text-sm tabular-nums ${chosen.count > chosen.limit ? "font-semibold text-red-700 dark:text-red-400" : muted}`}>
              {chosen.count.toLocaleString("en-US")} / {chosen.limit.toLocaleString("en-US")}
            </span>
          </div>
          <pre aria-labelledby="send-preview-h" tabIndex={0}
            className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-neutral-300 p-3 font-mono text-sm dark:border-neutral-700">
            {chosen.text}
          </pre>
          <p className={`mt-1 text-xs ${muted}`}>To change it, edit the draft above and save it first.</p>
        </div>
      )}

      <fieldset>
        <legend className={label}>When</legend>
        <div className="mt-1 space-y-2">
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="queue" checked={mode === "queue"} onChange={() => setMode("queue")} />
            <span>Add to queue <span className={`text-sm ${muted}`}>(Buffer picks the next slot)</span></span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="custom" checked={mode === "custom"} onChange={() => setMode("custom")} />
            <span>At a specific time</span>
          </label>
        </div>
        {mode === "custom" && (
          <div className="mt-3">
            <label htmlFor="send-local" className={label}>Date and time <span className="font-normal">({tzLabel})</span></label>
            <input id="send-local" name="local" type="datetime-local" required value={local} onChange={(e) => setLocal(e.target.value)}
              className={`${input} max-w-xs`} aria-describedby="send-local-preview" aria-invalid={due !== null && !due.ok} />
            <p id="send-local-preview" aria-live="polite" className="mt-1 text-sm">
              {!local ? <span className={muted}>Pick a date and time.</span>
                : due?.ok ? <span className="break-words">{dueAtPreview(due.utcIso, tz)}</span>
                : due ? <span className={fieldError}>{DUE_AT_ERROR_TEXT[due.code]}</span> : null}
            </p>
          </div>
        )}
      </fieldset>

      {needsConfirm && chosen && (
        <div role="alert" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <p>
            You already sent an earlier version of this lesson to {chosen.name} on {chosen.priorSentLabel}.
            Sending again makes a second Buffer draft.
          </p>
          <label className="mt-2 flex items-center gap-2 font-medium">
            <input type="checkbox" name="confirmAnother" value="yes" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Yes, send another copy
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton disabled={!chosen || timeBlocked || (needsConfirm && !confirmed)} />
        {mode === "custom" && local && (
          <button type="button" className={btn} onClick={() => setLocal("")}>Clear time</button>
        )}
      </div>
    </form>
  );
}
