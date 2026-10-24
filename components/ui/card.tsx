import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("rounded-xl border border-line bg-surface p-6", className)} {...props} />;
}

export function CardHeader({
  title,
  aside,
  className,
  as: Heading = "h2",
}: {
  title: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-center justify-between gap-3", className)}>
      <Heading className="text-[18px] font-semibold text-ink">{title}</Heading>
      {aside ? <div className="flex items-center gap-2">{aside}</div> : null}
    </div>
  );
}

export function Stat({ label, value, extra }: { label: string; value: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-page px-4 py-3">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-3 font-mono text-[22px] text-ink">
        {value}
        {extra}
      </div>
    </div>
  );
}
