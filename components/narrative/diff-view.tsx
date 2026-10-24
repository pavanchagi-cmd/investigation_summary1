import type { SectionDiff } from "@/lib/narrative/diff";

/** Word-level diff: insertions green-underlined, deletions red-struck, per section with counts. */
export function DiffView({ sections }: { sections: SectionDiff[] }) {
  return (
    <div className="narrative-doc">
      {sections.map((s) => (
        <section key={s.heading} aria-label={s.heading}>
          <h2>
            {s.heading}{" "}
            {s.added || s.removed ? (
              <span className="ml-2 font-mono text-[11px] normal-case tracking-normal text-muted">
                +{s.added} / −{s.removed}
              </span>
            ) : null}
          </h2>
          <p className="whitespace-pre-wrap">
            {s.parts.map((p, i) =>
              p.added ? (
                <ins key={i} className="diff-ins">
                  {p.value}
                </ins>
              ) : p.removed ? (
                <del key={i} className="diff-del">
                  {p.value}
                </del>
              ) : (
                <span key={i}>{p.value}</span>
              ),
            )}
          </p>
        </section>
      ))}
    </div>
  );
}
