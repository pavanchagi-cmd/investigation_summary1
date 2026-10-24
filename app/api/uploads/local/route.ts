import { NextResponse } from "next/server";
import { getEditableCase, requireRole } from "@/lib/auth/guard";
import { HttpError, route } from "@/lib/http";
import { MAX_UPLOAD_BYTES, allowedMime, putFile, storageMode } from "@/lib/storage";

/** Local development / test fallback when no Blob store is configured. Disabled on Vercel. */
export const POST = route(async (req) => {
  if (storageMode() !== "local") throw new HttpError(404, "Not available");
  const user = await requireRole(["analyst"]);
  const form = await req.formData();
  const caseId = Number(form.get("caseId"));
  await getEditableCase(caseId, user);
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file");
  const mime = allowedMime(file.name);
  if (!mime) throw new HttpError(400, `${file.name}: file type not accepted`);
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(400, `${file.name}: larger than 25 MB`);
  const url = await putFile(caseId, file.name, Buffer.from(await file.arrayBuffer()), mime);
  return NextResponse.json({ url });
});
