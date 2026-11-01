"use client";
import { useActionState, useId } from "react";
import { saveProduct, type FormState } from "@/app/products/actions";
import { DEFAULT_BRAND_COLOR } from "@/lib/lessons/validation";
import { fieldError, input, label, primary } from "./ui";

type Initial = { id?: string; name?: string; url?: string; brandColor?: string | null };

export function ProductForm({ initial = {}, submitLabel }: { initial?: Initial; submitLabel: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveProduct, { nonce: 0 });
  const uid = useId();
  const v = state.values ?? {};
  const f = state.fields ?? {};
  const color = v.brandColor || initial.brandColor || DEFAULT_BRAND_COLOR;
  const ids = { name: `${uid}-name`, url: `${uid}-url`, color: `${uid}-color` };
  const err = (k: string) => (f[k] ? { "aria-invalid": true, "aria-describedby": `${uid}-${k}-err` } : {});

  return (
    <form key={state.nonce} action={action} className="space-y-4" noValidate>
      {initial.id && <input type="hidden" name="productId" value={initial.id} />}
      {state.error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{state.error}</p>}
      <div>
        <label htmlFor={ids.name} className={label}>Product name</label>
        <input id={ids.name} name="name" required maxLength={80} defaultValue={v.name ?? initial.name ?? ""} className={input} autoComplete="off" {...err("name")} />
        {f.name && <p id={`${uid}-name-err`} className={fieldError}>{f.name}</p>}
      </div>
      <div>
        <label htmlFor={ids.url} className={label}>Product page URL <span className="font-normal">(https only)</span></label>
        <input id={ids.url} name="url" type="url" inputMode="url" required maxLength={500} placeholder="https://example.com/product"
          defaultValue={v.url ?? initial.url ?? ""} className={input} autoComplete="url" {...err("url")} />
        {f.url && <p id={`${uid}-url-err`} className={fieldError}>{f.url}</p>}
      </div>
      <div>
        <label htmlFor={ids.color} className={label}>Brand color</label>
        <input id={ids.color} name="brandColor" type="color" defaultValue={/^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_BRAND_COLOR}
          className="mt-1 h-10 w-20 cursor-pointer rounded border border-neutral-400 bg-transparent p-1 dark:border-neutral-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" {...err("brandColor")} />
        {f.brandColor && <p id={`${uid}-brandColor-err`} className={fieldError}>{f.brandColor}</p>}
      </div>
      <button type="submit" className={primary} disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
    </form>
  );
}
