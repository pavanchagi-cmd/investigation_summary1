import { SECTION_HEADINGS, SECTION_KEYS, type SectionKey } from "@/lib/llm/schemas";

/** Minimal TipTap / ProseMirror JSON types used on the server and in the browser. */
export type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; text?: string; marks?: { type: string }[] };
export type PMDoc = { type: "doc"; content: PMNode[] };

export const headingText = (key: SectionKey) => `${SECTION_KEYS.indexOf(key) + 1}. ${SECTION_HEADINGS[key]}`;

function paragraphsFromBody(body: string): PMNode[] {
  const blocks = body.replace(/\r/g, "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out: PMNode[] = [];
  const isBullet = (l: string) => /^\s*[-•*]\s+/.test(l);
  for (const b of blocks) {
    // Consecutive bullet lines become a list; other lines (e.g. a lead-in such as "For escalation:") a paragraph.
    let para: string[] = [];
    let items: string[] = [];
    const flushPara = () => {
      if (para.length) out.push({ type: "paragraph", content: [{ type: "text", text: para.join(" ") }] });
      para = [];
    };
    const flushList = () => {
      if (items.length) {
        out.push({
          type: "bulletList",
          content: items.map((t) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] })),
        });
      }
      items = [];
    };
    for (const l of b.split("\n")) {
      if (isBullet(l)) {
        flushPara();
        items.push(l.replace(/^\s*[-•*]\s+/, "").trim());
      } else if (l.trim()) {
        flushList();
        para.push(l.trim());
      }
    }
    flushPara();
    flushList();
  }
  return out.length ? out : [{ type: "paragraph" }];
}

/** Gemini sections → TipTap JSON (headings are the fixed section headings). */
export function sectionsToDoc(sections: { key: SectionKey; body: string }[]): PMDoc {
  const content: PMNode[] = [];
  for (const key of SECTION_KEYS) {
    const s = sections.find((x) => x.key === key);
    content.push({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: headingText(key) }] });
    content.push(...paragraphsFromBody(s?.body ?? "Not provided in the documents."));
  }
  return { type: "doc", content };
}

export function nodeText(n: PMNode): string {
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  const inner = (n.content ?? []).map(nodeText);
  if (n.type === "table") return (n.content ?? []).map((row) => (row.content ?? []).map((c) => nodeText(c).trim()).join(" | ")).join("\n");
  if (n.type === "bulletList" || n.type === "orderedList") return (n.content ?? []).map((li, i) => `${n.type === "orderedList" ? `${i + 1}.` : "-"} ${nodeText(li).trim()}`).join("\n");
  if (n.type === "listItem") return inner.join("\n");
  return inner.join("");
}

export type DocSection = { key: SectionKey | null; heading: string; text: string; nodes: PMNode[] };

/** Splits a document into sections at level-2 headings that match the fixed headings. */
export function docSections(doc: PMDoc): DocSection[] {
  const out: DocSection[] = [];
  let cur: DocSection | null = null;
  for (const n of doc.content ?? []) {
    if (n.type === "heading") {
      const text = nodeText(n).trim();
      const key = SECTION_KEYS.find((k) => headingText(k).toLowerCase() === text.toLowerCase()) ?? null;
      if (key || !cur) {
        cur = { key, heading: text, text: "", nodes: [] };
        out.push(cur);
        continue;
      }
    }
    if (!cur) {
      cur = { key: null, heading: "", text: "", nodes: [] };
      out.push(cur);
    }
    cur.nodes.push(n);
  }
  for (const s of out) s.text = s.nodes.map(nodeText).filter((t) => t.trim()).join("\n\n");
  return out;
}

/** Plain text with section headings, for copy/paste into the case management system. */
export function docToText(doc: PMDoc): string {
  return docSections(doc)
    .map((s) => [s.heading.toUpperCase(), s.text].filter(Boolean).join("\n\n"))
    .join("\n\n")
    .trim();
}

/** Replaces one section's body (keeps its heading) – used by "Regenerate section". */
export function replaceSection(doc: PMDoc, key: SectionKey, body: string): PMDoc {
  const content: PMNode[] = [];
  let skipping = false;
  let replaced = false;
  for (const n of doc.content ?? []) {
    if (n.type === "heading") {
      const text = nodeText(n).trim().toLowerCase();
      const isTarget = text === headingText(key).toLowerCase();
      const isOther = SECTION_KEYS.some((k) => headingText(k).toLowerCase() === text);
      if (isTarget) {
        content.push(n, ...paragraphsFromBody(body));
        skipping = true;
        replaced = true;
        continue;
      }
      if (isOther) skipping = false;
    }
    if (!skipping) content.push(n);
  }
  if (!replaced) {
    content.push({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: headingText(key) }] }, ...paragraphsFromBody(body));
  }
  return { type: "doc", content };
}
