import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11.5px] font-medium", {
  variants: {
    tone: {
      ai: "bg-ai-soft text-ai",
      risk: "bg-risk-soft text-risk",
      ok: "bg-ok-soft text-ok",
      accent: "bg-accent-soft text-accent",
      neutral: "bg-page text-muted",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({
  tone,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
