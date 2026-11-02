"use client";
import { useActionState, useId } from "react";
import { saveResultDay } from "@/app/campaigns/results-actions";
import type { FormState } from "@/app/products/actions";
import { fieldError, input, label, muted, primary } from "./ui";

const COUNTS = [{ key: "visits", label: "Visits" }, { key: "purchases", label: "Purchases" }] as const;
const MONEY = [
  { key: "revenue", label: "Revenue" }, { key: "fees", label: "Fees" },
  { key: "refunds", label: "Refunds" }, { key: "adSpend", label: "Ad spend" },
] as const;

export function ResultDayForm({ campaignId, defaultDay, latestDay }: { campaignId: string; defaultDay: string; latestDay: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveResultDay, { nonce: 0 });
  const uid = useId();
  const v = state.values ?? {};
  const f = state.fields ?? {};
  const err = (k: string) => (f[k] ? { "aria-invalid": true, "aria-describedby": `${uid}-${k}-err` } : {});
  const errText = (k: string) => (f[k] ? <p id={`${uid}-${k}-err`} className={fieldError}>{f[k]}</p> : null);

  return (
    <form key={state.nonce} action={action} className="space-y-4" noValidate>
      <input type="hidden" name="campaignId" value={campaignId} />
      {state.error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{state.error}</p>}
      <div>
        <label htmlFor={`${uid}-day`} className={label}>Day</label>
        <input id={`${uid}-day`} name="day" type="date" required max={latestDay} defaultValue={v.day ?? defaultDay} className={`${input} max-w-xs`} {...err("day")} />
        <p className={`mt-1 text-xs ${muted}`}>Saving a day that already has numbers updates it.</p>
        {errText("day")}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {COUNTS.map((c) => (
          <div key={c.key}>
            <label htmlFor={`${uid}-${c.key}`} className={label}>{c.label}</label>
            <input id={`${uid}-${c.key}`} name={c.key} inputMode="numeric" autoComplete="off" placeholder="0" defaultValue={v[c.key] ?? ""} className={`${input} tabular-nums`} {...err(c.key)} />
            {errText(c.key)}
          </div>
        ))}
        {MONEY.map((m) => (
          <div key={m.key}>
            <label htmlFor={`${uid}-${m.key}`} className={label}>{m.label} <span className="font-normal">($)</span></label>
            <input id={`${uid}-${m.key}`} name={m.key} inputMode="decimal" autoComplete="off" placeholder="0.00" defaultValue={v[m.key] ?? ""} className={`${input} tabular-nums`} {...err(m.key)} />
            {errText(m.key)}
          </div>
        ))}
      </div>
      <p className={`text-xs ${muted}`}>Whole numbers for visits and purchases; amounts like 12.30 (no negatives). Blank counts as 0.</p>
      <button type="submit" className={primary} disabled={pending}>{pending ? "Saving…" : "Save day"}</button>
    </form>
  );
}
