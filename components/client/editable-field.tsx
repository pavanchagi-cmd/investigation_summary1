"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Input, Label } from "@/components/ui/form";
import { SourceChip } from "@/components/case/document-preview";
import { useSave } from "@/components/case/save-status";
import { api } from "@/lib/client/api";
import { formatFieldValue } from "@/lib/display";
import type { FieldView } from "@/lib/cases/fields";
import { cn } from "@/lib/utils";

/**
 * One Q3 field: shows the AI value (or the analyst's edit), its source, and saves on blur.
 * An empty AI value reads "Not provided in documents" and is never filled with a guess.
 */
export function EditableField({
  caseId,
  fieldKey,
  label,
  field,
  readOnly,
  hint,
  className,
}: {
  caseId: number;
  fieldKey: string;
  label: string;
  field: FieldView | undefined;
  readOnly: boolean;
  hint?: string;
  className?: string;
}) {
  const router = useRouter();
  const track = useSave();
  const display = formatFieldValue(fieldKey, field?.value);
  const [value, setValue] = React.useState(display);
  React.useEffect(() => setValue(display), [display]);
  const id = `q3-${fieldKey}`;
  const missing = !display;

  async function save() {
    if (value.trim() === display.trim()) return;
    await track(api(`/api/cases/${caseId}/fields`, { method: "PATCH", body: { question: "q3", fieldKey, value: value.trim() || null } }));
    router.refresh();
  }

  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        readOnly={readOnly}
        placeholder={missing ? "Not provided in documents" : undefined}
        className={cn(missing && "border-dashed border-ai/40 placeholder:italic placeholder:text-ai")}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
      />
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
        {field?.sourceRef && field.status === "ai" ? <SourceChip source={field.sourceRef} /> : null}
        {field?.status === "edited" ? (
          <span className="text-[12px] text-accent">Edited by analyst{field.sourceRef ? " · " : ""}</span>
        ) : null}
        {field?.status === "edited" && field.sourceRef ? <SourceChip source={field.sourceRef} /> : null}
        {missing && hint ? <span className="text-[12px] text-muted">{hint}</span> : null}
      </div>
    </div>
  );
}
