import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { caseFields, users, type Case } from "@/lib/db/schema";
import { listVersions } from "@/lib/narrative/service";
import { docSections, type PMDoc, type PMNode, nodeText } from "@/lib/narrative/doc";
import { maskAccountsInText } from "@/lib/mask";
import { formatDate } from "@/lib/format";

export type Block = { kind: "p"; text: string } | { kind: "ul"; items: string[] } | { kind: "table"; rows: string[][] } | { kind: "h3"; text: string };
export type ExportModel = {
  alertNumber: string;
  client: string;
  reviewPeriod: string;
  analyst: string;
  approvedAt: string | null;
  status: string;
  version: number;
  disposition: string;
  rationale: string;
  sections: { heading: string; blocks: Block[] }[];
  footer: string;
};

export const DISPOSITION_LABEL: Record<string, string> = {
  escalate_sar: "Escalate to SAR/STR review",
  close_nfa: "Close – no further action",
  request_info: "Request more information",
};

const m = (s: string) => maskAccountsInText(s);

function blocks(nodes: PMNode[]): Block[] {
  const out: Block[] = [];
  for (const n of nodes) {
    if (n.type === "paragraph") {
      const t = nodeText(n).trim();
      if (t) out.push({ kind: "p", text: m(t) });
    } else if (n.type === "heading") out.push({ kind: "h3", text: m(nodeText(n).trim()) });
    else if (n.type === "bulletList" || n.type === "orderedList") out.push({ kind: "ul", items: (n.content ?? []).map((li) => m(nodeText(li).trim())) });
    else if (n.type === "table") out.push({ kind: "table", rows: (n.content ?? []).map((r) => (r.content ?? []).map((c) => m(nodeText(c).trim()))) });
    else {
      const t = nodeText(n).trim();
      if (t) out.push({ kind: "p", text: m(t) });
    }
  }
  return out;
}

/** Same content for Word, PDF and text: case header, narrative, disposition, rationale, analyst, approval time. */
export async function buildExportModel(c: Case): Promise<ExportModel | null> {
  const db = await getDb();
  const versions = await listVersions(c.id);
  if (!versions.length) return null;
  const latest = versions[versions.length - 1];
  const [analyst] = await db.select({ name: users.name }).from(users).where(eq(users.id, c.createdBy));
  const [nameField] = await db
    .select()
    .from(caseFields)
    .where(and(eq(caseFields.caseId, c.id), eq(caseFields.question, "q3"), eq(caseFields.fieldKey, "client_name")));
  const client = String(nameField?.analystValue ?? nameField?.aiValue ?? "Not provided in documents");
  const approvedAt = c.approvedAt ? `${formatDate(c.approvedAt.toISOString().slice(0, 10))} ${c.approvedAt.toISOString().slice(11, 16)} UTC` : null;
  return {
    alertNumber: c.alertNumber,
    client,
    reviewPeriod: c.reviewStart && c.reviewEnd ? `${formatDate(c.reviewStart)} – ${formatDate(c.reviewEnd)}` : "Not set",
    analyst: analyst?.name ?? "",
    approvedAt,
    status: c.status === "approved" ? "Approved" : "Draft – not yet approved",
    version: latest.version,
    disposition: c.disposition ? DISPOSITION_LABEL[c.disposition] : "Not recorded",
    rationale: m(c.rationale ?? "Not recorded"),
    sections: docSections(latest.contentJson as PMDoc).map((s) => ({ heading: s.heading, blocks: blocks(s.nodes) })),
    footer:
      c.status === "approved"
        ? `Draft prepared with AI assistance; reviewed and approved by ${analyst?.name ?? "the analyst"}`
        : "Draft prepared with AI assistance; not yet approved by the analyst",
  };
}

export function modelToText(x: ExportModel): string {
  const lines = [
    `INVESTIGATION SUMMARY – ${x.alertNumber}`,
    `Client: ${x.client}`,
    `Review period: ${x.reviewPeriod}`,
    `Analyst: ${x.analyst}`,
    `Status: ${x.status}${x.approvedAt ? ` (${x.approvedAt})` : ""}`,
    "",
  ];
  for (const s of x.sections) {
    lines.push(s.heading.toUpperCase(), "");
    for (const b of s.blocks) {
      if (b.kind === "p" || b.kind === "h3") lines.push(b.text, "");
      else if (b.kind === "ul") lines.push(...b.items.map((i) => `- ${i}`), "");
      else lines.push(...b.rows.map((r) => r.join(" | ")), "");
    }
  }
  lines.push("DISPOSITION", "", x.disposition, "", "RATIONALE", "", x.rationale, "", x.footer);
  return lines.join("\n");
}
