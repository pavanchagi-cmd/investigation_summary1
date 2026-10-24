import { z } from "zod";
import { getCaseForUser, requireRole } from "@/lib/auth/guard";
import { HttpError, idParam, route } from "@/lib/http";
import { logAudit } from "@/lib/audit/log";
import { buildExportModel, modelToText } from "@/lib/export/model";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 60;

const Query = z.object({ format: z.enum(["docx", "pdf", "txt"]) });

export const GET = route(async (req, { params }: Ctx) => {
  const user = await requireRole(["analyst", "qa", "admin"]);
  const c = await getCaseForUser(idParam((await params).id), user);
  const { format } = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const model = await buildExportModel(c);
  if (!model) throw new HttpError(409, "Generate the narrative before exporting");
  const base = `investigation-summary-${c.alertNumber}`;
  let body: Uint8Array;
  let type: string;
  if (format === "txt") {
    body = new TextEncoder().encode(modelToText(model));
    type = "text/plain; charset=utf-8";
  } else if (format === "docx") {
    const { buildDocx } = await import("@/lib/export/docx");
    body = new Uint8Array(await buildDocx(model));
    type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else {
    const { buildPdf } = await import("@/lib/export/pdf");
    body = new Uint8Array(await buildPdf(model));
    type = "application/pdf";
  }
  await logAudit({ caseId: c.id, actorId: user.id, action: "exported", entity: "case", entityId: c.id, after: { format, version: model.version } });
  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${format === "txt" ? "inline" : "attachment"}; filename="${base}.${format}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
