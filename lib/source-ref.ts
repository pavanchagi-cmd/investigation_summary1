/** Source references are stored as "file · p.N", "file · row N" or "file · rows A–B" (spec section 6). */
export type SourceRef = { file: string; page?: number; row?: number; rowEnd?: number; note?: string };

export function formatSourceRef(ref: SourceRef): string {
  const parts = [ref.file];
  if (ref.page != null) parts.push(`p.${ref.page}`);
  else if (ref.row != null && ref.rowEnd != null && ref.rowEnd !== ref.row) parts.push(`rows ${ref.row}–${ref.rowEnd}`);
  else if (ref.row != null) parts.push(`row ${ref.row}`);
  if (ref.note) parts.push(ref.note);
  return parts.join(" · ");
}

export function parseSourceRef(text: string | null | undefined): SourceRef | null {
  if (!text) return null;
  const [file, ...rest] = text.split(" · ");
  if (!file) return null;
  const ref: SourceRef = { file: file.trim() };
  const notes: string[] = [];
  for (const part of rest) {
    const p = part.trim();
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^p\.?\s*(\d+)$/i))) ref.page = Number(m[1]);
    else if ((m = p.match(/^rows?\s+(\d+)\s*[–-]\s*(\d+)$/i))) {
      ref.row = Number(m[1]);
      ref.rowEnd = Number(m[2]);
    } else if ((m = p.match(/^row\s+(\d+)$/i))) ref.row = Number(m[1]);
    else notes.push(p);
  }
  if (notes.length) ref.note = notes.join(" · ");
  return ref;
}
