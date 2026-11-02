"use client";
import { useFormStatus } from "react-dom";
import { primary } from "./ui";

/** A submit button that disables itself while its form's Server Action runs (no double submits). */
export function PendingButton({ label, pendingLabel, className = primary }: { label: string; pendingLabel: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}
