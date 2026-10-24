import { diffArrays } from "diff";
import { docSections, type PMDoc } from "./doc";

export type DiffPart = { value: string; added?: boolean; removed?: boolean };
export type SectionDiff = { heading: string; parts: DiffPart[]; added: number; removed: number };

const tokens = (s: string) => s.split(/\s+/).filter(Boolean);

/**
 * Word-level diff of the analyst version against AI draft v1, per section (words are
 * whitespace-separated tokens), plus "% of AI text kept" = unchanged words ÷ AI draft words.
 */
export function diffDocs(ai: PMDoc, analyst: PMDoc) {
  const a = docSections(ai);
  const b = docSections(analyst);
  const headings = [...new Set([...a.map((s) => s.heading), ...b.map((s) => s.heading)])];
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  let aiWords = 0;
  const sections: SectionDiff[] = headings.map((h) => {
    const before = tokens(a.find((s) => s.heading === h)?.text ?? "");
    const after = tokens(b.find((s) => s.heading === h)?.text ?? "");
    aiWords += before.length;
    const changes = diffArrays(before, after);
    let sa = 0;
    let sr = 0;
    const parts: DiffPart[] = changes.map((c) => {
      if (c.added) sa += c.value.length;
      else if (c.removed) sr += c.value.length;
      else unchanged += c.value.length;
      return { value: c.value.join(" ") + " ", added: c.added || undefined, removed: c.removed || undefined };
    });
    added += sa;
    removed += sr;
    return { heading: h, parts, added: sa, removed: sr };
  });
  return { sections, added, removed, pctKept: aiWords ? Math.round((unchanged / aiWords) * 1000) / 10 : 100 };
}
