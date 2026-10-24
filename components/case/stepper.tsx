"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const STEPS = [
  { slug: "intake", label: "Alert & documents" },
  { slug: "client", label: "Client & counterparties" },
  { slug: "purpose", label: "Purpose & red flags" },
  { slug: "narrative", label: "Narrative & decision" },
] as const;

/** Four-step stepper; the analyst can move back and forth freely. */
export function Stepper({ caseId, done }: { caseId: number; done: boolean[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Case steps" className="mt-5">
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => {
          const href = `/cases/${caseId}/${s.slug}`;
          const current = pathname === href;
          return (
            <li key={s.slug}>
              <Link
                href={href}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex h-11 items-center gap-2 rounded-lg px-4 text-[14px]",
                  current ? "bg-accent font-semibold text-white" : "bg-page text-ink hover:bg-accent-soft",
                )}
              >
                {done[i] && !current ? <Check className="size-4 text-ink" aria-label="complete" /> : <span>{i + 1}</span>}
                {s.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
