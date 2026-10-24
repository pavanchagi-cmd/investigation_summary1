import * as React from "react";
import type { PMDoc, PMNode } from "@/lib/narrative/doc";

/** Read-only rendering of TipTap JSON (original AI draft, QA view). */
function renderNode(n: PMNode, key: React.Key): React.ReactNode {
  const kids = (n.content ?? []).map((c, i) => renderNode(c, i));
  switch (n.type) {
    case "text": {
      let el: React.ReactNode = n.text;
      for (const m of n.marks ?? []) {
        if (m.type === "bold") el = <strong>{el}</strong>;
        else if (m.type === "italic") el = <em>{el}</em>;
        else if (m.type === "underline") el = <u>{el}</u>;
      }
      return <React.Fragment key={key}>{el}</React.Fragment>;
    }
    case "heading":
      return Number(n.attrs?.level) === 2 ? <h2 key={key}>{kids}</h2> : <h3 key={key}>{kids}</h3>;
    case "paragraph":
      return <p key={key}>{kids}</p>;
    case "bulletList":
      return <ul key={key}>{kids}</ul>;
    case "orderedList":
      return <ol key={key}>{kids}</ol>;
    case "listItem":
      return <li key={key}>{kids}</li>;
    case "hardBreak":
      return <br key={key} />;
    case "table":
      return (
        <table key={key}>
          <tbody>{kids}</tbody>
        </table>
      );
    case "tableRow":
      return <tr key={key}>{kids}</tr>;
    case "tableHeader":
      return <th key={key}>{kids}</th>;
    case "tableCell":
      return <td key={key}>{kids}</td>;
    default:
      return <React.Fragment key={key}>{kids}</React.Fragment>;
  }
}

export function DocView({ doc }: { doc: PMDoc }) {
  return <div className="narrative-doc">{(doc.content ?? []).map((n, i) => renderNode(n, i))}</div>;
}
