"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TableKit } from "@tiptap/extension-table";
import { Bold, Heading3, Italic, List, Loader2, RefreshCw, Table as TableIcon, Underline as UnderlineIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select } from "@/components/ui/form";
import { AiDraftBadge } from "@/components/case/badges";
import { useSave } from "@/components/case/save-status";
import { api } from "@/lib/client/api";
import { DISPOSITION_EVENT, narrativeFlush } from "@/lib/client/flush";
import { AI_SECTION_KEYS, SECTION_HEADINGS, type AiSectionKey, type SectionKey } from "@/lib/llm/schemas";
import { docSections, sectionKeyForHeading, withDisposition, type PMDoc } from "@/lib/narrative/doc";
import type { SectionDiff } from "@/lib/narrative/diff";
import { cn } from "@/lib/utils";
import { DocView } from "./doc-view";
import { DiffView } from "./diff-view";

const IDLE_MS = 5_000;
const MIN_GAP_MS = 60_000;

type DiffData = { sections: SectionDiff[]; added: number; removed: number; pctKept: number };

export function NarrativeWorkspace({
  caseId,
  initialDoc,
  aiDraft,
  diff,
  locked,
}: {
  caseId: number;
  initialDoc: PMDoc;
  aiDraft: PMDoc;
  diff: DiffData;
  locked: boolean;
}) {
  const router = useRouter();
  const track = useSave();
  const [tab, setTab] = React.useState<"analyst" | "ai" | "diff">("analyst");
  const [dirty, setDirty] = React.useState(false);
  const lastSaved = React.useRef(0);
  const idleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = React.useRef<Editor | null>(null);
  const [regen, setRegen] = React.useState<AiSectionKey | null>(null);
  const [regenBusy, setRegenBusy] = React.useState(false);
  const [regenError, setRegenError] = React.useState<string | null>(null);
  const [cursorSection, setCursorSection] = React.useState<SectionKey>("alert_overview");

  const save = React.useCallback(
    async (opts: { keepalive?: boolean } = {}) => {
      const ed = editorRef.current;
      if (!ed || locked) return;
      const doc = ed.getJSON() as PMDoc;
      lastSaved.current = Date.now();
      setDirty(false);
      if (opts.keepalive) {
        void fetch(`/api/cases/${caseId}/narrative`, {
          method: "PUT",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doc }),
        });
        return;
      }
      await track(api(`/api/cases/${caseId}/narrative`, { method: "PUT", body: { doc } }));
      router.refresh();
    },
    [caseId, locked, router, track],
  );

  // Autosave after 5 s of inactivity, at most once a minute (rows are never updated; DECISIONS I8).
  const schedule = React.useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    const wait = Math.max(IDLE_MS, lastSaved.current + MIN_GAP_MS - Date.now());
    idleTimer.current = setTimeout(() => void save(), wait);
  }, [save]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !locked,
    extensions: [StarterKit.configure({ underline: false, link: false, heading: { levels: [2, 3] } }), Underline, TableKit.configure({ table: { resizable: false } })],
    content: initialDoc,
    editorProps: {
      attributes: { class: "narrative-doc min-h-[480px] px-10 py-8", "aria-label": "Case narrative", role: "textbox", "aria-multiline": "true" },
    },
    onUpdate: () => {
      setDirty(true);
      schedule();
    },
    onSelectionUpdate: ({ editor: ed }) => {
      // Which section is the cursor in? (for Regenerate section)
      const pos = ed.state.selection.from;
      let current: SectionKey = "alert_overview";
      ed.state.doc.forEach((node, offset) => {
        if (offset > pos || node.type.name !== "heading") return;
        const k = sectionKeyForHeading(node.textContent);
        if (k) current = k;
      });
      setCursorSection(current);
    },
  });
  React.useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  React.useEffect(() => {
    editor?.setEditable(!locked);
  }, [editor, locked]);

  // Section 3 follows the analyst's decision and saved comments in the Disposition panel (an analyst edit, saved like any other).
  React.useEffect(() => {
    const onDisposition = (e: Event) => {
      const ed = editorRef.current;
      if (!ed || locked) return;
      const current = ed.getJSON() as PMDoc;
      const { disposition, comments } = (e as CustomEvent<{ disposition: string | null; comments: string }>).detail;
      const next = withDisposition(current, disposition, comments);
      if (JSON.stringify(next) !== JSON.stringify(current)) ed.commands.setContent(next, { emitUpdate: true });
    };
    window.addEventListener(DISPOSITION_EVENT, onDisposition);
    return () => window.removeEventListener(DISPOSITION_EVENT, onDisposition);
  }, [locked]);

  // Flush unsaved edits when the tab is hidden or the page unloads.
  React.useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden" && dirty) void save({ keepalive: true });
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [dirty, save]);
  React.useEffect(() => () => void (idleTimer.current && clearTimeout(idleTimer.current)), []);

  // Expose a flush for the Approve and Export buttons.
  React.useEffect(() => {
    narrativeFlush.current = async () => {
      if (dirty) await save();
    };
  }, [dirty, save]);

  async function doRegenerate(key: AiSectionKey) {
    setRegenBusy(true);
    setRegenError(null);
    try {
      if (dirty) await save();
      const { doc } = await track(api<{ doc: PMDoc }>(`/api/cases/${caseId}/narrative`, { body: { sectionKey: key, confirmReplace: true } }));
      editor?.commands.setContent(doc, { emitUpdate: false });
      lastSaved.current = Date.now();
      setRegen(null);
      router.refresh();
    } catch (e) {
      setRegenError((e as Error).message);
    } finally {
      setRegenBusy(false);
    }
  }

  const edited = diff.added + diff.removed > 0 || dirty;
  const sectionsWithText = docSections(aiDraft).length;

  return (
    <section aria-labelledby="narrative-title" className="min-w-0 rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <h2 id="narrative-title" className="text-[18px] font-semibold">
          Case narrative
        </h2>
        <div role="tablist" aria-label="Narrative views" className="inline-flex rounded-lg bg-page p-1 text-[13.5px]">
          {(
            [
              ["analyst", "Analyst version"],
              ["ai", "Original AI draft v1"],
              ["diff", `Diff (+${diff.added} / −${diff.removed})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={tab === k}
              onClick={() => {
                if (k !== "analyst" && dirty) void save();
                setTab(k);
              }}
              className={cn("rounded-md px-3 py-1.5", tab === k ? "bg-surface font-semibold shadow-sm" : "text-muted hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "analyst" ? (
        <>
          <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2">
            <ToolButton label="Bold" active={editor?.isActive("bold")} disabled={locked} onClick={() => editor?.chain().focus().toggleBold().run()}>
              <Bold />
            </ToolButton>
            <ToolButton label="Italic" active={editor?.isActive("italic")} disabled={locked} onClick={() => editor?.chain().focus().toggleItalic().run()}>
              <Italic />
            </ToolButton>
            <ToolButton label="Underline" active={editor?.isActive("underline")} disabled={locked} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
              <UnderlineIcon />
            </ToolButton>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            <ToolButton label="Subheading" active={editor?.isActive("heading", { level: 3 })} disabled={locked} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>
              <Heading3 />
            </ToolButton>
            <ToolButton label="Bullet list" active={editor?.isActive("bulletList")} disabled={locked} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
              <List />
            </ToolButton>
            <ToolButton label="Insert table" disabled={locked} onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
              <TableIcon />
            </ToolButton>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            <Button variant="ghost" size="sm" disabled={locked} onClick={() => setRegen(cursorSection === "disposition" ? "alert_overview" : cursorSection)}>
              <RefreshCw /> Regenerate section
            </Button>
            <span className="ml-auto">
              <AiDraftBadge state={edited ? "edited" : "ai"} />
            </span>
          </div>
          <EditorContent editor={editor} />
          {!editor ? <div className="px-10 py-8 text-muted">Loading editor…</div> : null}
        </>
      ) : tab === "ai" ? (
        <div className="px-10 py-8">
          <p className="mb-4 text-[12.5px] text-muted">Read-only. Version 1 as drafted by Gemini; it is never changed.</p>
          <DocView doc={aiDraft} />
        </div>
      ) : (
        <div className="px-10 py-8">
          <p className="mb-4 text-[12.5px] text-muted">
            Latest analyst version compared with AI draft v1 · {diff.pctKept}% of AI text kept · {sectionsWithText} sections
          </p>
          <DiffView sections={diff.sections} />
        </div>
      )}

      <Dialog open={!!regen} onOpenChange={(o) => !o && setRegen(null)}>
        {regen ? (
          <DialogContent title="Regenerate section" description="Gemini redrafts one section from the same input. Your edits in that section will be replaced.">
            <label htmlFor="regen-section" className="text-[13px] font-medium">
              Section
            </label>
            <Select id="regen-section" value={regen} onChange={(e) => setRegen(e.target.value as AiSectionKey)} className="mt-1">
              {AI_SECTION_KEYS.map((k, i) => (
                <option key={k} value={k}>
                  {i + 1}. {SECTION_HEADINGS[k]}
                </option>
              ))}
            </Select>
            {regenError ? <p className="mt-3 text-[13px] text-risk">{regenError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setRegen(null)}>Cancel</Button>
              <Button variant="primary" disabled={regenBusy} onClick={() => doRegenerate(regen)}>
                {regenBusy ? <Loader2 className="animate-spin" /> : null} Replace my edits and regenerate
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </section>
  );
}

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={!!active}
      disabled={disabled}
      onClick={onClick}
      className={cn("rounded p-2 text-ink hover:bg-page disabled:opacity-40 [&_svg]:size-4", active && "bg-accent-soft text-accent")}
    >
      {children}
    </button>
  );
}
