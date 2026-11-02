"use client";
import { useActionState, useId } from "react";
import { createCampaign, updateCampaign } from "@/app/campaigns/actions";
import type { FormState } from "@/app/products/actions";
import { fieldError, input, label, muted, primary } from "./ui";

export type BriefInitial = {
  productId?: string | null; name?: string | null; goal?: string | null; audience?: string | null; angle?: string | null;
  keyMessage?: string | null; cta?: string | null; startsOn?: string | null; endsOn?: string | null; utmCampaign?: string | null;
};

const FIELDS: { key: keyof BriefInitial; label: string; max: number; area?: boolean; hint?: string }[] = [
  { key: "name", label: "Campaign name", max: 80 },
  { key: "goal", label: "Goal", max: 200, hint: "What should this campaign achieve? For example: Get 20 sign-ups to the free sample." },
  { key: "audience", label: "Audience", max: 200, hint: "Who is it for?" },
  { key: "angle", label: "Offer / angle", max: 300, area: true, hint: "What are you offering, and why now?" },
  { key: "keyMessage", label: "Key message", max: 280, area: true, hint: "The one thing a reader should remember. It opens every post and headlines the creative." },
  { key: "cta", label: "Call to action", max: 60, hint: "For example: Get the template" },
];

export function CampaignBriefForm({ products, initial = {}, campaignId, submitLabel }: {
  products: { id: string; name: string }[]; initial?: BriefInitial; campaignId?: string; submitLabel: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(campaignId ? updateCampaign : createCampaign, { nonce: 0 });
  const uid = useId();
  const v = state.values ?? {};
  const f = state.fields ?? {};
  const val = (k: keyof BriefInitial) => v[k] ?? initial[k] ?? "";
  const err = (k: string) => (f[k] ? { "aria-invalid": true, "aria-describedby": `${uid}-${k}-err` } : {});
  const errText = (k: string) => (f[k] ? <p id={`${uid}-${k}-err`} className={fieldError}>{f[k]}</p> : null);

  return (
    <form key={state.nonce} action={action} className="space-y-4" noValidate>
      {campaignId && <input type="hidden" name="campaignId" value={campaignId} />}
      {state.error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{state.error}</p>}
      <div>
        <label htmlFor={`${uid}-productId`} className={label}>Product</label>
        <select id={`${uid}-productId`} name="productId" required defaultValue={val("productId")} className={input} {...err("productId")}>
          {!val("productId") && <option value="">Pick a product…</option>}
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {errText("productId")}
      </div>
      {FIELDS.map((fd) => {
        const id = `${uid}-${fd.key}`;
        const common = { id, name: fd.key, required: true, maxLength: fd.max, defaultValue: val(fd.key), className: input, ...err(fd.key) };
        return (
          <div key={fd.key}>
            <label htmlFor={id} className={label}>{fd.label}</label>
            {fd.area ? <textarea rows={3} {...common} /> : <input autoComplete="off" {...common} />}
            {fd.hint && <p className={`mt-1 text-xs ${muted}`}>{fd.hint} Max {fd.max} characters.</p>}
            {errText(fd.key)}
          </div>
        );
      })}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${uid}-startsOn`} className={label}>Starts on <span className="font-normal">(optional)</span></label>
          <input id={`${uid}-startsOn`} name="startsOn" type="date" defaultValue={val("startsOn")} className={input} {...err("startsOn")} />
          {errText("startsOn")}
        </div>
        <div>
          <label htmlFor={`${uid}-endsOn`} className={label}>Ends on <span className="font-normal">(optional)</span></label>
          <input id={`${uid}-endsOn`} name="endsOn" type="date" defaultValue={val("endsOn")} className={input} {...err("endsOn")} />
          {errText("endsOn")}
        </div>
      </div>
      <p className={`text-xs ${muted}`}>Dates are planning labels only. They don&apos;t schedule anything.</p>
      <div>
        <label htmlFor={`${uid}-utm`} className={label}>UTM campaign <span className="font-normal">(optional)</span></label>
        <input id={`${uid}-utm`} name="utmCampaign" maxLength={60} placeholder="spring-launch" defaultValue={val("utmCampaign")}
          className={`${input} font-mono`} autoComplete="off" {...err("utmCampaign")} />
        <p className={`mt-1 text-xs ${muted}`}>Lower-case letters, numbers and dashes. Leave blank to use the campaign name.</p>
        {errText("utmCampaign")}
      </div>
      <button type="submit" className={primary} disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
    </form>
  );
}
