"use client";
import { useActionState, useId } from "react";
import { saveLesson, type FormState } from "@/app/products/actions";
import { FORMAT_LABELS, LESSON_FORMATS, type LessonFormat } from "@/lib/lessons/templates";
import { fieldError, input, label, muted, primary } from "./ui";

type Initial = { id?: string; productId?: string; term?: string; definition?: string; example?: string | null; format?: LessonFormat };

const HINTS: Record<LessonFormat, { term: string; definition: string; example: string }> = {
  glossary: { term: "The word or phrase", definition: "A plain-language definition", example: "A sentence that uses it" },
  prompt_demo: { term: "What the prompt does", definition: "Why the prompt works", example: "The prompt itself" },
  misconception: { term: "The myth people believe", definition: "What's actually true", example: "A concrete example" },
};

export function LessonForm({ initial = {}, submitLabel }: { initial?: Initial; submitLabel: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveLesson, { nonce: 0 });
  const uid = useId();
  const v = state.values ?? {};
  const f = state.fields ?? {};
  const format = (LESSON_FORMATS as readonly string[]).includes(v.format ?? "") ? (v.format as LessonFormat) : initial.format ?? "glossary";
  const err = (k: string) => (f[k] ? { "aria-invalid": true, "aria-describedby": `${uid}-${k}-err` } : {});
  const hint = HINTS[format];

  return (
    <form key={state.nonce} action={action} className="space-y-4" noValidate>
      {initial.id && <input type="hidden" name="lessonId" value={initial.id} />}
      {initial.productId && <input type="hidden" name="productId" value={initial.productId} />}
      {state.error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{state.error}</p>}
      <fieldset>
        <legend className={label}>Format</legend>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
          {LESSON_FORMATS.map((fm) => (
            <label key={fm} className="flex items-center gap-2">
              <input type="radio" name="format" value={fm} defaultChecked={fm === format} />
              <span>{FORMAT_LABELS[fm]}</span>
            </label>
          ))}
        </div>
        {f.format && <p className={fieldError}>{f.format}</p>}
      </fieldset>
      <div>
        <label htmlFor={`${uid}-term`} className={label}>Term</label>
        <input id={`${uid}-term`} name="term" required maxLength={80} defaultValue={v.term ?? initial.term ?? ""} className={input} autoComplete="off" {...err("term")} />
        <p className={`mt-1 text-xs ${muted}`}>Glossary: {HINTS.glossary.term.toLowerCase()} · Prompt: {HINTS.prompt_demo.term.toLowerCase()} · Myth: {HINTS.misconception.term.toLowerCase()}.</p>
        {f.term && <p id={`${uid}-term-err`} className={fieldError}>{f.term}</p>}
      </div>
      <div>
        <label htmlFor={`${uid}-definition`} className={label}>Definition</label>
        <textarea id={`${uid}-definition`} name="definition" required maxLength={600} rows={3} defaultValue={v.definition ?? initial.definition ?? ""} className={input} {...err("definition")} />
        <p className={`mt-1 text-xs ${muted}`}>{hint.definition}. Max 600 characters.</p>
        {f.definition && <p id={`${uid}-definition-err`} className={fieldError}>{f.definition}</p>}
      </div>
      <div>
        <label htmlFor={`${uid}-example`} className={label}>Example <span className="font-normal">(optional)</span></label>
        <textarea id={`${uid}-example`} name="example" maxLength={600} rows={3} defaultValue={v.example ?? initial.example ?? ""} className={input} {...err("example")} />
        <p className={`mt-1 text-xs ${muted}`}>For a prompt demonstration, put the prompt itself here. Max 600 characters.</p>
        {f.example && <p id={`${uid}-example-err`} className={fieldError}>{f.example}</p>}
      </div>
      <button type="submit" className={primary} disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
    </form>
  );
}
