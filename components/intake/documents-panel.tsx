"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { useSave } from "@/components/case/save-status";
import { api } from "@/lib/client/api";
import { DOC_TYPE_LABELS } from "@/lib/parsing/detect";
import { AUTO_CORRECTED_PREFIX } from "@/lib/parsing/values";
import type { DocumentSummary } from "@/lib/documents/service";
import type { IssueRow } from "@/lib/documents/issues";
import { cn } from "@/lib/utils";
import { ExcludeDialog, FixRowsDialog, MappingDialog, CurrencyDialog, RemoveDocumentDialog } from "./issue-dialogs";

const ACCEPT = ".pdf,.xlsx,.xls,.csv,.docx,.png,.jpg,.jpeg";
const ACCEPTED_EXT = new Set(["pdf", "xlsx", "xls", "csv", "docx", "png", "jpg", "jpeg"]);
const MAX_BYTES = 25 * 1024 * 1024;

function statusText(d: DocumentSummary) {
  if (d.parseStatus === "pending") return { text: "Parsing…", tone: "text-muted" };
  if (d.parseStatus === "failed") return { text: "Could not be read", tone: "text-risk" };
  if (d.needsMapping) return { text: "Columns need mapping", tone: "text-ai" };
  const rowsNotParsed = d.issues.open;
  if (rowsNotParsed) return { text: `${rowsNotParsed} issue${rowsNotParsed === 1 ? "" : "s"} to resolve`, tone: "text-ai" };
  const isImage = d.mimeType.startsWith("image/");
  if (isImage) return { text: `OCR · ${d.confidence != null ? Math.round(d.confidence * 100) + "% conf." : "parsed"}`, tone: "text-ok" };
  const unit = /pdf/.test(d.mimeType) ? "pp" : "rows";
  const excluded = d.issues.excluded ? ` · ${d.issues.excluded} excluded` : "";
  return { text: `Parsed${d.pageOrRowCount ? ` · ${d.pageOrRowCount} ${unit}` : ""}${excluded}`, tone: "text-ok" };
}

export function DocumentsPanel({
  caseId,
  readOnly,
  documents,
  issues,
  uploadMode,
  demoFiles,
}: {
  caseId: number;
  readOnly: boolean;
  documents: DocumentSummary[];
  issues: IssueRow[];
  uploadMode: "blob" | "local";
  demoFiles: string[];
}) {
  const router = useRouter();
  const track = useSave();
  const input = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<string[]>([]);

  async function uploadOne(file: File) {
    let url: string;
    if (uploadMode === "blob") {
      const { upload } = await import("@vercel/blob/client");
      const safe = file.name.replace(/[^\w.\-() ]+/g, "_");
      const blob = await upload(`cases/${caseId}/${safe}`, file, {
        access: "private",
        handleUploadUrl: "/api/uploads/token",
        clientPayload: JSON.stringify({ caseId }),
        multipart: file.size > 8 * 1024 * 1024,
      });
      url = blob.url;
    } else {
      const fd = new FormData();
      fd.set("caseId", String(caseId));
      fd.set("file", file);
      const res = await fetch("/api/uploads/local", { method: "POST", body: fd });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? "Upload failed");
      url = json.url;
    }
    await api(`/api/cases/${caseId}/documents`, { body: { blobUrl: url, fileName: file.name, sizeBytes: file.size } });
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    const problems: string[] = [];
    const ok = list.filter((f) => {
      const ext = f.name.toLowerCase().split(".").pop() ?? "";
      if (!ACCEPTED_EXT.has(ext)) {
        problems.push(`${f.name}: only PDF, XLSX/XLS, CSV, DOCX, PNG and JPG files are accepted.`);
        return false;
      }
      if (f.size > MAX_BYTES) {
        problems.push(`${f.name}: larger than 25 MB.`);
        return false;
      }
      return true;
    });
    for (const f of ok) {
      setBusy(`Uploading ${f.name}…`);
      try {
        await track(uploadOne(f));
      } catch (err) {
        problems.push(`${f.name}: ${(err as Error).message}`);
      }
    }
    setBusy(null);
    setErrors(problems);
    router.refresh();
  }

  async function attachDemo() {
    setBusy("Attaching demo documents…");
    try {
      await track(api(`/api/cases/${caseId}/demo-documents`, { body: {} }));
    } catch (err) {
      setErrors([(err as Error).message]);
    }
    setBusy(null);
    router.refresh();
  }

  async function retry(d: DocumentSummary) {
    try {
      await track(api(`/api/documents/${d.id}`, { method: "PATCH", body: { reparse: true } }));
    } catch (err) {
      setErrors([`${d.fileName}: ${(err as Error).message}`]);
    }
    router.refresh();
  }

  async function changeType(d: DocumentSummary, type: string) {
    await track(api(`/api/documents/${d.id}`, { method: "PATCH", body: { confirmedType: type } }));
    router.refresh();
  }

  return (
    <Card>
      <CardHeader title="Documents" />
      {!readOnly ? (
        <>
          <div
            className={cn(
              "flex flex-col items-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors",
              drag ? "border-accent bg-accent-soft" : "border-line",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void handleFiles(e.dataTransfer.files);
            }}
          >
            <Upload className="size-5 text-muted" aria-hidden />
            <p className="mt-2 text-[14px] font-semibold">
              Drop files or{" "}
              <button type="button" className="text-accent underline" onClick={() => input.current?.click()}>
                browse
              </button>
            </p>
            <p className="mt-1 text-[12.5px] text-muted">PDF, XLSX/XLS, CSV, DOCX, PNG/JPG (OCR) · max 25 MB each</p>
            <input
              ref={input}
              type="file"
              multiple
              accept={ACCEPT}
              className="sr-only"
              aria-label="Upload documents"
              onChange={(e) => {
                if (e.target.files) void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {demoFiles.length > 0 && documents.length === 0 ? (
            <Button className="mt-3 w-full" onClick={attachDemo} disabled={!!busy}>
              Attach demo documents ({demoFiles.length} synthetic files)
            </Button>
          ) : null}
          {busy ? (
            <p role="status" className="mt-3 flex items-center gap-2 text-[13px] text-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {busy}
            </p>
          ) : null}
          {errors.length ? (
            <ul role="alert" className="mt-3 space-y-1 rounded-md bg-risk-soft px-3 py-2 text-[13px] text-risk">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      <ul className="mt-4 space-y-3">
        {documents.map((d) => {
          const st = statusText(d);
          const docIssues = issues.filter((i) => i.documentId === d.id && i.resolution === "open");
          const autoFixed = issues.filter(
            (i) => i.documentId === d.id && i.resolution === "fixed" && i.resolutionReason?.startsWith(AUTO_CORRECTED_PREFIX),
          );
          const hasProblem = d.parseStatus === "failed" || docIssues.length > 0 || d.needsMapping;
          return (
            <li key={d.id} className={cn("rounded-lg border p-3", hasProblem ? "border-ai/50 bg-ai-soft/40" : "border-line")}>
              <div className="flex items-start justify-between gap-3">
                <span className="break-all font-mono text-[13px]">{d.fileName}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className={cn("text-[12.5px] font-medium", st.tone)}>{st.text}</span>
                  {!readOnly ? <RemoveDocumentDialog doc={d} trigger={<Trash2 />} /> : null}
                </span>
              </div>
              <Select
                aria-label={`Document type for ${d.fileName}`}
                className="mt-2 h-9 text-[13px]"
                value={d.type ?? ""}
                disabled={readOnly || d.parseStatus === "pending"}
                onChange={(e) => changeType(d, e.target.value)}
              >
                {d.type ? null : <option value="">Detecting type…</option>}
                {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              {d.parseStatus === "failed" ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {d.parseError ? <p className="min-w-0 flex-1 text-[12.5px] text-risk">{d.parseError}</p> : null}
                  {!readOnly ? (
                    <Button size="sm" onClick={() => retry(d)} aria-label={`Retry reading ${d.fileName}`}>
                      <RotateCw /> Retry
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {docIssues.length > 0 && !d.needsMapping ? (
                <p className="mt-2 text-[12.5px] text-muted">
                  {docIssues
                    .slice(0, 3)
                    .map((i) => `${i.sourceRowOrPage.replace(/^row/, "Row")}: ${i.problem}`)
                    .join(" · ")}
                  {docIssues.length > 3 ? ` · +${docIssues.length - 3} more` : ""}
                </p>
              ) : null}
              {autoFixed.length > 0 ? (
                <div className="mt-2 rounded-md bg-ai-soft px-3 py-2 text-[12.5px]">
                  <p className="font-medium text-ai">
                    {autoFixed.length} value{autoFixed.length === 1 ? "" : "s"} auto-corrected – analyst to verify
                  </p>
                  <ul className="mt-1 space-y-0.5 font-mono text-[12px] text-ink">
                    {autoFixed.map((i) => (
                      <li key={i.id}>
                        {i.sourceRowOrPage.replace(/^row/, "Row")} · {i.field}: &quot;{i.rawValue}&quot; → {i.fixedValues?.[i.field ?? ""]}
                      </li>
                    ))}
                  </ul>
                  {!readOnly ? (
                    <div className="mt-2">
                      <FixRowsDialog caseId={caseId} doc={d} issues={autoFixed} label="Change" />
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!readOnly && d.needsMapping ? (
                <div className="mt-2">
                  <MappingDialog doc={d} />
                </div>
              ) : null}
              {!readOnly && docIssues.length > 0 && !d.needsMapping ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <FixRowsDialog caseId={caseId} doc={d} issues={docIssues} />
                  <ExcludeDialog caseId={caseId} doc={d} count={docIssues.length} />
                  {docIssues.some((i) => i.field === "currency" && i.problem.includes("not stated")) ? (
                    <CurrencyDialog doc={d} />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
