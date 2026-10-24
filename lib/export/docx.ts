import "server-only";
import { AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { ExportModel } from "./model";

const FONT = "IBM Plex Sans";
const SERIF = "IBM Plex Serif";

export async function buildDocx(x: ExportModel): Promise<Buffer> {
  const kv = (k: string, v: string) =>
    new TableRow({
      children: [
        new TableCell({ width: { size: 28, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, font: FONT, size: 18 })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: v, font: FONT, size: 18 })] })] }),
      ],
    });
  const body: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: "Investigation summary", font: FONT, bold: true, size: 36 })] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        kv("Alert number", x.alertNumber),
        kv("Client", x.client),
        kv("Review period", x.reviewPeriod),
        kv("Analyst", x.analyst),
        kv("Approval", x.approvedAt ? `Approved ${x.approvedAt}` : x.status),
        kv("Narrative version", `v${x.version}`),
      ],
    }),
    new Paragraph({ text: "" }),
  ];
  for (const s of x.sections) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, children: [new TextRun({ text: s.heading.toUpperCase(), font: FONT, bold: true, size: 20 })] }));
    for (const b of s.blocks) {
      if (b.kind === "p") body.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: b.text, font: SERIF, size: 22 })] }));
      else if (b.kind === "h3") body.push(new Paragraph({ children: [new TextRun({ text: b.text, font: FONT, bold: true, size: 20 })] }));
      else if (b.kind === "ul") for (const i of b.items) body.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: i, font: SERIF, size: 22 })] }));
      else
        body.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: b.rows.map((r) => new TableRow({ children: r.map((c) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c, font: FONT, size: 18 })] })] })) })),
          }),
        );
    }
  }
  body.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 360, after: 80 },
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: "D9DEE5", space: 8 } },
      children: [new TextRun({ text: "DISPOSITION", font: FONT, bold: true, size: 20 })],
    }),
    new Paragraph({ children: [new TextRun({ text: x.disposition, font: FONT, bold: true, size: 22 })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: "RATIONALE", font: FONT, bold: true, size: 20 })] }),
    new Paragraph({ children: [new TextRun({ text: x.rationale, font: SERIF, size: 22 })] }),
  );
  const doc = new Document({
    creator: "TM Summary Drafter",
    title: `Investigation summary ${x.alertNumber}`,
    sections: [
      {
        footers: {
          default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: x.footer, font: FONT, size: 16, color: "4A5565" })] })] }),
        },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
