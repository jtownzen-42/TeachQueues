"use client";
import { startTransition, useActionState, useMemo, useRef, useState } from "react";
import { saveDraft, type FormState } from "@/app/products/actions";
import {
  charCount, draftProblems, plural, LIMITS, NETWORK_LABELS, NETWORKS,
  type DraftTexts, type Network, type ProductFields,
} from "@/lib/lessons/templates";
import { btn, card, fieldError, input, muted, primary } from "./ui";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers/contexts without the async clipboard API.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

function NetworkBox({ network, value, onChange, serverError }: {
  network: Network; value: string; onChange: (v: string) => void; serverError?: string;
}) {
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = charCount(value, network);
  const limit = LIMITS[network];
  const over = count > limit;
  const id = `draft-${network}`;
  const name = NETWORK_LABELS[network];

  async function onCopy() {
    const ok = await copyText(value);
    setCopied(ok ? "ok" : "fail");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(""), 2500);
  }

  return (
    <section className={card} aria-labelledby={`${id}-h`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${id}-h`} className="text-lg font-semibold"><label htmlFor={id}>{name}</label></h3>
        <span id={`${id}-count`} className={`text-sm tabular-nums ${over ? "font-semibold text-red-700 dark:text-red-400" : muted}`}>
          {count.toLocaleString("en-US")} / {limit.toLocaleString("en-US")}
          {network === "x" && <span className="sr-only"> (links count as 23)</span>}
        </span>
      </div>
      <textarea
        id={id} name={network} value={value} onChange={(e) => onChange(e.target.value)}
        rows={network === "x" ? 7 : 10} spellCheck className={`${input} font-mono text-sm`}
        aria-invalid={over || Boolean(serverError)} aria-describedby={`${id}-count${over || serverError ? ` ${id}-err` : ""}`}
      />
      {over && <p id={`${id}-err`} role="alert" className={fieldError}>Over the {name} limit by {plural(count - limit, "character")}. Shorten it before saving.</p>}
      {!over && serverError && <p id={`${id}-err`} role="alert" className={fieldError}>{serverError}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={btn} onClick={onCopy}>Copy text</button>
        <span role="status" aria-live="polite" className={`text-sm ${muted}`}>
          {copied === "ok" ? `${name} text copied.` : copied === "fail" ? "Couldn't copy. Select the text and press Ctrl+C." : ""}
        </span>
      </div>
      {network === "x" && <p className={`mt-2 text-xs ${muted}`}>X counts every link as 23 characters, and emoji or CJK characters as 2.</p>}
    </section>
  );
}

export function DraftEditor({ lessonId, product, generated, saved, savedLabel }: {
  lessonId: string; product: ProductFields; generated: DraftTexts; saved: DraftTexts | null; savedLabel: string | null;
}) {
  const [texts, setTexts] = useState<DraftTexts>(saved ?? generated);
  const [state, action, pending] = useActionState<FormState, FormData>(saveDraft, { nonce: 0 });
  const [dirty, setDirty] = useState(false);
  const problems = useMemo(() => draftProblems(texts, product), [texts, product]);
  const blocked = Object.keys(problems).length > 0;
  const differsFromTemplate = NETWORKS.some((n) => texts[n] !== generated[n]);

  function set(n: Network, v: string) {
    setTexts((t) => ({ ...t, [n]: v }));
    setDirty(true);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked) return;
    const fd = new FormData(e.currentTarget);
    setDirty(false);
    startTransition(() => action(fd));
  }

  const serverFields = dirty ? {} : state.fields ?? {};
  const firstProblem = NETWORKS.map((n) => problems[n]).find(Boolean);

  return (
    <form action={action} onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="lessonId" value={lessonId} />
      <p className={`text-sm ${muted}`}>
        {saved ? `Showing your saved draft${savedLabel ? ` (${savedLabel})` : ""}.` : "Not saved yet. These drafts come from the lesson template."}
        {" "}Every draft ends with <span className="break-all font-medium">{product.name} — {product.url}</span>.
      </p>
      {NETWORKS.map((n) => (
        <NetworkBox key={n} network={n} value={texts[n]} onChange={(v) => set(n, v)} serverError={problems[n] ?? serverFields[n]} />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={primary} disabled={pending || blocked} aria-describedby={blocked ? "draft-blocked" : undefined}>
          {pending ? "Saving…" : "Save as draft"}
        </button>
        <button type="button" className={btn} disabled={!differsFromTemplate}
          onClick={() => { setTexts(generated); setDirty(true); }}>
          Redraft from lesson
        </button>
        <span role="status" aria-live="polite" className="text-sm">
          {pending ? "" : !dirty && state.ok ? state.ok : !dirty && state.error ? <span className="text-red-700 dark:text-red-400">{state.error}</span> : dirty ? <span className={muted}>Unsaved changes.</span> : ""}
        </span>
      </div>
      {blocked && <p id="draft-blocked" className={`text-sm ${muted}`}>Can&apos;t save yet: {firstProblem}</p>}
      <p className={`text-xs ${muted}`}>Saving stores this draft in TeachQueue only. Nothing is sent to Buffer yet.</p>
    </form>
  );
}
