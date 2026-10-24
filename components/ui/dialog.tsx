"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  side,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  /** "right" renders a drawer, otherwise a centred dialog. */
  side?: "right";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/30" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden border border-line bg-surface shadow-xl",
          side === "right"
            ? "inset-y-0 right-0 w-full max-w-[440px]"
            : "left-1/2 top-1/2 max-h-[90vh] w-[calc(100%-32px)] max-w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-xl",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <DialogPrimitive.Title className="text-[16px] font-semibold">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-[13px] text-muted">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="rounded-md border border-line p-1.5 text-muted hover:bg-page"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="flex-1 overflow-auto px-6 py-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
