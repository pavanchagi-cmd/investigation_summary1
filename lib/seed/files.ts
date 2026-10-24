import * as XLSX from "@e965/xlsx";
import PDFDocument from "pdfkit";
import { Document as DocxDocument, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun, WidthType } from "docx";
import type { SeedAlert, SeedTxn } from "./types";

/** File builders for the synthetic demo document sets (scripts/generate-seed.ts). */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const longDate = (iso: string) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const TXN_HEADERS = [
  "Value Date",
  "Txn Ref",
  "Dr/Cr",
  "Amount",
  "CCY",
  "Channel",
  "Beneficiary/Remitter",
  "Counterparty Account",
  "Counterparty Bank",
  "Bank Country",
  "Originator Country",
  "Beneficiary Country",
  "Narrative",
];

function excelSerial(iso: string) {
  return Math.round(Date.parse(iso + "T00:00:00Z") / 86_400_000) + 25569;
}

function txnRow(t: SeedTxn, clientCountry: string) {
  return [
    excelSerial(t.date),
    t.txnId,
    t.direction === "incoming" ? "CR" : "DR",
    t.amount,
    t.currency,
    t.typeText,
    t.cp.name,
    t.cp.account,
    t.cp.bank,
    t.cp.bankCountry,
    t.direction === "incoming" ? t.cp.country : clientCountry,
    t.direction === "incoming" ? clientCountry : t.cp.country,
    t.reference,
  ];
}

/** Transactions workbook: title row, blank row, header row 3, data from row 4; malformed rows at fixed rows. */
export function transactionsXlsx(a: SeedAlert): Buffer {
  const account = a.client.accounts[0]?.number ?? "";
  const rows: unknown[][] = [[`Account statement · ${a.client.name} · a/c ${account} · Currency: USD`], [], TXN_HEADERS];
  const data: (string | number | null)[][] = a.txns.map((t) => txnRow(t, a.client.incorporationCountry));
  // Insert malformed rows so they land exactly on their Excel row numbers.
  for (const m of [...a.malformed].sort((x, y) => x.excelRow - y.excelRow)) {
    const idx = m.excelRow - 4;
    const template: (string | number | null)[] = [...data[Math.min(idx, data.length - 1)]];
    template[1] = `${template[1]}-X`;
    for (const [k, v] of Object.entries(m.cells)) {
      const col = k === "Amount" ? 3 : k === "Date" ? 0 : TXN_HEADERS.indexOf(k);
      template[col] = v;
    }
    data.splice(idx, 0, template);
  }
  rows.push(...data);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Date cells as real Excel dates, amounts with 2 decimals.
  for (let r = 3; r < rows.length; r++) {
    const d = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (d && typeof d.v === "number") d.z = "yyyy-mm-dd";
    const amt = ws[XLSX.utils.encode_cell({ r, c: 3 })];
    if (amt && typeof amt.v === "number") amt.z = "#,##0.00";
  }
  ws["!cols"] = [12, 14, 6, 14, 6, 12, 32, 24, 26, 8, 8, 8, 34].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transactions");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function counterpartiesCsv(a: SeedAlert): Buffer {
  const esc = (v: string | null) => (v == null ? "" : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["Name,Account Number,Bank,Bank Country,Country,Relationship,Notes"];
  for (const c of a.counterparties) lines.push([c.name, c.account, c.bank, c.bankCountry, c.country, c.relationship, c.notes].map(esc).join(","));
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

type Pdf = InstanceType<typeof PDFDocument>;

/** Small pdfkit layout helpers; every page carries the synthetic-data banner and a footer. */
function pdfDoc(title: string, footer: string) {
  const doc: Pdf = new PDFDocument({ size: "A4", margin: 48, info: { Title: title, Producer: "TM Summary Drafter seed generator" }, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const banner = () => doc.font("Helvetica").fontSize(8).fillColor("#7A4100").text("SYNTHETIC DEMO DATA - fictional client, no real customer information.").moveDown(0.8);
  banner();
  return {
    doc,
    newPage: () => {
      doc.addPage();
      banner();
    },
    title: (t: string, sub?: string) => {
      doc.font("Helvetica-Bold").fontSize(15).fillColor("#16202B").text(t);
      if (sub) doc.font("Helvetica").fontSize(9).fillColor("#4A5565").text(sub);
      doc.moveDown(0.8);
    },
    h2: (t: string) => doc.moveDown(0.6).font("Helvetica-Bold").fontSize(11).fillColor("#16202B").text(t).moveDown(0.3),
    kv: (k: string, v: string) => {
      const y = doc.y;
      doc.font("Helvetica").fontSize(10).fillColor("#4A5565").text(k, 48, y, { width: 180 });
      doc.fillColor("#16202B").text(v, 240, y, { width: 307 });
      doc.moveTo(48, doc.y + 3).lineTo(547, doc.y + 3).lineWidth(0.5).strokeColor("#D9DEE5").stroke();
      doc.y += 7;
      doc.x = 48;
    },
    finish: () => {
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        doc.font("Helvetica").fontSize(8).fillColor("#4A5565").text(`${footer} · Page ${i + 1} of ${range.count}`, 48, 800, { width: 499, lineBreak: false });
      }
      doc.end();
      return done;
    },
  };
}

const scenarioName = {
  large_amount: "Large Amount Transaction",
  pattern_of_funds: "Pattern of Funds",
  round_dollar: "Round Dollar Transaction",
  wire_structuring: "Wire Structuring",
};

export async function alertReportPdf(a: SeedAlert): Promise<Buffer> {
  const p = pdfDoc(`Alert report ${a.alertNumber}`, `${a.alertNumber} · alert report`);
  p.title("Transaction Monitoring - Alert Report", `Alert ${a.alertNumber} · generated ${longDate(a.alertDate)}`);
  p.kv("Alert number", a.alertNumber);
  p.kv("Alert date", longDate(a.alertDate));
  p.kv("Client name", a.client.name);
  p.kv("Client ID / CIF", a.client.cif);
  a.client.accounts.forEach((acc, i) => p.kv(`Account involved ${i + 1}`, `${acc.number} (opened ${longDate(acc.opened)})`));
  p.kv("Review period", `${longDate(a.reviewStart)} - ${longDate(a.reviewEnd)}`);
  p.kv("Lookback", `Lookback ${a.lookbackDays} days`);
  p.kv("Number of sub-alerts", String(a.subAlerts.length));
  const lastPage = Math.max(2, ...a.subAlerts.map((s) => s.page));
  for (let page = 2; page <= lastPage; page++) {
    p.newPage();
    p.title("Sub-alert details");
    for (const s of a.subAlerts.filter((x) => x.page === page)) {
      p.h2(`Sub-alert ${s.number}`);
      p.kv("Scenario", scenarioName[s.scenario]);
      p.kv("Rule ID", s.ruleId);
      p.kv("Threshold", s.threshold);
      p.kv("Trigger details", s.details);
      p.kv("Triggering transactions", String(s.triggeringCount));
    }
  }
  return p.finish();
}

export async function kycPdf(a: SeedAlert): Promise<Buffer> {
  const c = a.client;
  const p = pdfDoc(`KYC profile ${c.cif}`, `KYC profile · CIF ${c.cif}`);
  p.title("Customer Due Diligence Profile", `CIF ${c.cif}`);
  p.h2("1. Identity");
  p.kv("Client name", c.name);
  p.kv("Client ID / CIF", c.cif);
  p.kv("Entity type", c.entityType);
  p.kv("Date of incorporation", longDate(c.incorporationDate));
  p.kv("Country of incorporation", c.incorporationCountry === "IN" ? "India" : c.incorporationCountry);
  p.newPage();
  p.h2("2. Business");
  p.kv("Nature of business", c.natureOfBusiness);
  if (c.industryCode) p.kv("Industry code", c.industryCode);
  p.kv("Declared annual turnover", `${c.turnover.currency} ${money(c.turnover.amount)}`);
  p.newPage();
  p.h2("3. Expected activity and risk");
  p.kv("Expected monthly volume", `About ${c.expected.monthlyVolume} transactions`);
  p.kv("Expected monthly value", `${c.expected.currency} ${money(c.expected.monthlyValue)}`);
  p.kv("Expected countries", c.expected.countries.join(", "));
  p.kv("Products", c.expected.products.join(", "));
  p.kv("Risk rating", c.riskRating);
  p.kv("PEP", c.pep);
  p.kv("Sanctions screening", c.sanctions);
  p.kv("Adverse media", c.adverseMedia.replace("–", "-"));
  p.kv("Prior alerts / SARs", `${c.priorAlerts} alerts · ${c.priorSars} SARs`);
  return p.finish();
}

export async function priorCasesDocx(a: SeedAlert): Promise<Buffer> {
  const cell = (t: string, bold = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold })] })] });
  const body = a.priorCases.length
    ? [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: ["Alert", "Date", "Scenario", "Outcome", "Summary"].map((t) => cell(t, true)) }),
            ...a.priorCases.map((p) => new TableRow({ children: [p.alertNumber, longDate(p.date), p.scenario, p.outcome, p.summary].map((t) => cell(t)) })),
          ],
        }),
      ]
    : [new Paragraph({ text: "No prior alerts or cases on record." })];
  const doc = new DocxDocument({
    sections: [
      {
        children: [
          new Paragraph({ text: "SYNTHETIC DEMO DATA – fictional client", spacing: { after: 120 } }),
          new Paragraph({ text: `Prior alert and case history – ${a.client.name} (CIF ${a.client.cif})`, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: `Prior alerts: ${a.client.priorAlerts}. Prior SARs: ${a.client.priorSars}.` }),
          ...body,
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** HTML for the scanned RFI letter; scripts/generate-seed.ts screenshots it to JPEG with Playwright. */
export function rfiHtml(a: SeedAlert): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#e9e6df}
    .sheet{width:760px;margin:20px;padding:48px 56px;background:#f7f5ef;font:15px/1.6 Georgia,serif;color:#222;transform:rotate(-0.6deg);box-shadow:0 0 0 1px #d8d3c8;filter:contrast(0.95) blur(0.25px)}
    h1{font-size:18px;margin:0 0 6px} .muted{color:#555;font-size:13px} .q{font-weight:bold;margin-top:14px}
  </style></head><body><div class="sheet">
    <div class="muted">SYNTHETIC DEMO DATA – fictional client</div>
    <h1>Response to request for information</h1>
    <div class="muted">${esc(a.client.name)} · CIF ${a.client.cif} · ${longDate(a.rfi.date)}</div>
    <p>Ref: alert ${a.alertNumber}</p>
    ${a.rfi.items.map((i, n) => `<div class="q">${n + 1}. ${esc(i.question)}</div><div>${esc(i.answer)}</div>`).join("")}
    <p style="margin-top:28px">Signed,<br>${esc(a.rfi.respondent)}</p>
  </div></body></html>`;
}
