import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import mammoth from "mammoth";
import { getDb } from "@/lib/db";
import { documents, parseIssues, transactions, type DocType, type DocumentRow } from "@/lib/db/schema";
import { getConfig } from "@/lib/config";
import { readFile, extensionOf } from "@/lib/storage";
import { applyReviewPeriod } from "@/lib/cases/service";
import { detectDocType } from "./detect";
import { readCsv, readWorkbook, currencyFromPreamble, sheetToText, type Sheet } from "./spreadsheet";
import { normaliseTransactions, type RawRow, type RowIssue, type NormalisedTxn } from "./normalise";
import { classifyDocument, extractDocument, type DocInput } from "./extract";
import { parseCounterpartyDetails } from "./counterparty-details";
import { prefillCase } from "./prefill";
import type { TransactionTableExtraction } from "@/lib/llm/schemas";

const STRUCTURED = new Set(["xlsx", "xls", "csv"]);

const TXN_TABLE_COLUMNS = [
  "date", "transaction_id", "direction", "debit", "credit", "amount", "currency", "type", "counterparty_name",
  "counterparty_account", "counterparty_bank", "counterparty_bank_country", "originator_country",
  "beneficiary_country", "reference_text",
];

function pdfPageCount(buf: Buffer): number | null {
  const n = buf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
  return n > 0 ? n : null;
}

async function loadSheet(buf: Buffer, ext: string): Promise<Sheet> {
  return ext === "csv" ? readCsv(buf) : readWorkbook(buf);
}

async function toDocInput(doc: DocumentRow, buf: Buffer, ext: string, sheet: Sheet | null): Promise<DocInput> {
  if (sheet) return { kind: "text", fileName: doc.fileName, text: sheetToText(sheet) };
  if (ext === "docx") {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { kind: "text", fileName: doc.fileName, text: value };
  }
  return { kind: "inline", fileName: doc.fileName, mimeType: doc.mimeType, data: buf };
}

/**
 * Parses one document end to end. Never drops data: rows either become transactions or parse
 * issues; whole-document failures set parse_status = failed with a readable reason.
 */
export async function processDocument(documentId: number, actorId: number | null, opts: { reuseExtraction?: boolean } = {}) {
  const db = await getDb();
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) return;
  await db.update(documents).set({ parseStatus: "pending", parseError: null }).where(eq(documents.id, doc.id));

  try {
    const buf = await readFile(doc.blobUrl);
    const ext = extensionOf(doc.fileName);
    const sheet = STRUCTURED.has(ext) ? await loadSheet(buf, ext) : null;

    let type: DocType | null = doc.confirmedType ?? detectDocType(doc.fileName, sheet?.headers);
    let detectedType = doc.detectedType;
    if (!doc.confirmedType) {
      if (!type) {
        const c = await classifyDocument(await toDocInput(doc, buf, ext, sheet), { caseId: doc.caseId, actorId });
        type = c.type;
      }
      detectedType = type;
    }
    const finalType: DocType = type ?? "other";
    await db.update(documents).set({ detectedType }).where(eq(documents.id, doc.id));

    if (finalType === "transaction_list") {
      if (sheet) {
        const stated = currencyFromPreamble(sheet.preamble);
        await storeTransactions(doc, sheet.headers, sheet.rows, stated, sheet.rows.length);
      } else {
        // Fix / mapping changes re-validate the rows Gemini already returned instead of calling it again.
        const prior = doc.extraction as { rawRows?: RawRow[]; headers?: string[]; pageCount?: number | null } | null;
        let headers: string[];
        let rows: RawRow[];
        let pages: number | null;
        if (opts.reuseExtraction && prior?.rawRows && prior.headers) {
          ({ headers, rawRows: rows } = prior as { headers: string[]; rawRows: RawRow[] });
          pages = prior.pageCount ?? null;
        } else {
          const res = await extractDocument("transaction_list", await toDocInput(doc, buf, ext, null), {
            caseId: doc.caseId,
            actorId,
          });
          const data = res.data as TransactionTableExtraction;
          headers = TXN_TABLE_COLUMNS;
          rows = data.rows.map((r, i) => ({
            sourceRow: `p.${r.page} · line ${i + 1}`,
            cells: Object.fromEntries(headers.map((h) => [h, (r as Record<string, unknown>)[h]])),
          }));
          pages = data.page_count ?? (ext === "pdf" ? pdfPageCount(buf) : 1);
        }
        await storeTransactions(doc, headers, rows, null, pages, rows);
      }
    } else if (finalType === "counterparty_details" && sheet) {
      const parsed = parseCounterpartyDetails(sheet);
      await clearDocumentRows(doc.id);
      await db
        .update(documents)
        .set({
          extraction: { type: "counterparty_details", rows: parsed.rows, unmappedHeaders: parsed.unmapped },
          pageOrRowCount: sheet.rows.length,
          parseStatus: parsed.issues.length ? "partial" : "parsed",
        })
        .where(eq(documents.id, doc.id));
      if (parsed.issues.length) await db.insert(parseIssues).values(parsed.issues.map((i) => ({ ...i, documentId: doc.id })));
    } else {
      await clearDocumentRows(doc.id);
      const res = await extractDocument(finalType, await toDocInput(doc, buf, ext, sheet), { caseId: doc.caseId, actorId });
      const data = res.data as { page_count?: number | null };
      const pages = sheet ? sheet.rows.length : (data.page_count ?? (ext === "pdf" ? pdfPageCount(buf) : ext === "docx" ? null : 1));
      await db
        .update(documents)
        .set({
          extraction: { type: finalType, data, model: res.model, promptVersion: res.promptVersion },
          pageOrRowCount: pages,
          confidence: averageConfidence(data),
          parseStatus: "parsed",
        })
        .where(eq(documents.id, doc.id));
    }

    await prefillCase(doc.caseId);
    await applyReviewPeriod(doc.caseId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Parsing failed";
    await db
      .update(documents)
      .set({ parseStatus: "failed", parseError: message.slice(0, 500) })
      .where(eq(documents.id, doc.id));
    console.error(`[parse] document ${doc.id} failed: ${err instanceof Error ? err.name : "Error"}`);
  }
}

async function clearDocumentRows(documentId: number) {
  const db = await getDb();
  await db.delete(transactions).where(eq(transactions.documentId, documentId));
  await db.delete(parseIssues).where(eq(parseIssues.documentId, documentId));
}

/** Writes normalised rows and issues, re-applying earlier analyst fixes and exclusions. */
async function storeTransactions(
  doc: DocumentRow,
  headers: string[],
  rows: RawRow[],
  statedCurrency: string | null,
  count: number | null,
  /** Rows that came from Gemini (PDF/image tables) are kept so fixes can re-validate them. */
  llmRows?: RawRow[],
) {
  const db = await getDb();
  const cfg = await getConfig();
  const previous = await db.select().from(parseIssues).where(eq(parseIssues.documentId, doc.id));
  const fixes = new Map<string, string>();
  const excluded = new Map<string, (typeof previous)[number]>();
  for (const p of previous) {
    if (p.resolution === "fixed" && p.fixedValues) {
      for (const [f, v] of Object.entries(p.fixedValues)) fixes.set(`${p.sourceRowOrPage}|${f}`, v);
    }
    if (p.resolution === "excluded") excluded.set(p.sourceRowOrPage, p);
  }

  const result = normaliseTransactions(headers, rows, {
    documentId: doc.id,
    documentCurrency: doc.currency ?? statedCurrency,
    fx: cfg.fx_rates,
    overrides: doc.columnMapping,
    fixes,
  });
  await clearDocumentRows(doc.id);

  if (result.missingColumns.length) {
    await db
      .update(documents)
      .set({
        parseStatus: "partial",
        pageOrRowCount: count,
        extraction: {
          type: "transaction_list",
          needsMapping: true,
          missing: result.missingColumns,
          headers,
          ...(llmRows ? { rawRows: llmRows, pageCount: count } : {}),
        },
      })
      .where(eq(documents.id, doc.id));
    await db.insert(parseIssues).values({
      documentId: doc.id,
      sourceRowOrPage: "document",
      field: "mapping",
      problem: `Columns could not be matched: ${result.missingColumns.join(", ")}. Map them to continue (${rows.length} rows waiting).`,
    });
    return;
  }

  const keptTxns: NormalisedTxn[] = result.txns.filter((t) => !excluded.has(t.sourceRow));
  const issues: RowIssue[] = [];
  const seenExcluded = new Set<string>();
  for (const i of result.issues) {
    if (excluded.has(i.sourceRowOrPage)) {
      if (seenExcluded.has(i.sourceRowOrPage)) continue;
      seenExcluded.add(i.sourceRowOrPage);
    }
    issues.push(i);
  }

  for (let i = 0; i < keptTxns.length; i += 500) {
    await db.insert(transactions).values(
      keptTxns.slice(i, i + 500).map((t) => ({ ...t, caseId: doc.caseId, documentId: doc.id })),
    );
  }
  const fixedRows = new Set([...fixes.keys()].map((k) => k.split("|")[0]));
  type IssueInsert = typeof parseIssues.$inferInsert;
  const issueRows: IssueInsert[] = issues.map((i) => {
    const prev = excluded.get(i.sourceRowOrPage);
    return {
      documentId: doc.id,
      sourceRowOrPage: i.sourceRowOrPage,
      field: i.field,
      rawValue: i.rawValue,
      problem: i.problem,
      rawRow: i.rawRow,
      resolution: prev ? ("excluded" as const) : ("open" as const),
      resolutionReason: prev?.resolutionReason ?? null,
      resolvedBy: prev?.resolvedBy ?? null,
    };
  });
  // Rows fixed or excluded earlier that no longer raise an issue keep their record (counts stay visible).
  const carried = new Set<string>();
  for (const p of previous) {
    const keepFixed = p.resolution === "fixed" && fixedRows.has(p.sourceRowOrPage);
    const keepExcluded = p.resolution === "excluded";
    if (!keepFixed && !keepExcluded) continue;
    if (issues.some((i) => i.sourceRowOrPage === p.sourceRowOrPage)) continue;
    const key = `${p.resolution}|${p.sourceRowOrPage}`;
    if (keepExcluded && carried.has(key)) continue;
    carried.add(key);
    issueRows.push({
      documentId: doc.id,
      sourceRowOrPage: p.sourceRowOrPage,
      field: p.field,
      rawValue: p.rawValue,
      problem: p.problem,
      rawRow: p.rawRow,
      resolution: p.resolution,
      resolutionReason: p.resolutionReason,
      resolvedBy: p.resolvedBy,
    });
  }
  if (issueRows.length) {
    const inserted = await db.insert(parseIssues).values(issueRows).returning({ id: parseIssues.id, row: parseIssues.sourceRowOrPage });
    // Carry the fixed values forward on the re-created records.
    for (const p of previous.filter((x) => x.resolution === "fixed" && x.fixedValues)) {
      const ids = inserted.filter((r) => r.row === p.sourceRowOrPage).map((r) => r.id);
      if (ids.length) await db.update(parseIssues).set({ fixedValues: p.fixedValues }).where(inArray(parseIssues.id, ids));
    }
  }

  const open = issueRows.filter((i) => i.resolution === "open").length;
  await db
    .update(documents)
    .set({
      parseStatus: open ? "partial" : "parsed",
      pageOrRowCount: count,
      extraction: {
        type: "transaction_list",
        headers,
        mapping: result.mapping,
        statedCurrency,
        ...(llmRows ? { rawRows: llmRows, pageCount: count } : {}),
      },
    })
    .where(and(eq(documents.id, doc.id)));
}

function averageConfidence(data: unknown): number | null {
  const values: number[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (typeof o.confidence === "number" && "value" in o && o.value != null) values.push(o.confidence);
    for (const v of Object.values(o)) walk(v);
  };
  walk(data);
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}
