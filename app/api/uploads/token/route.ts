import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getEditableCase, requireRole } from "@/lib/auth/guard";
import { HttpError, errorResponse } from "@/lib/http";
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES, allowedMime, storageMode } from "@/lib/storage";

/**
 * Issues short-lived client-upload tokens so the browser uploads straight to private Vercel
 * Blob (avoids the serverless request-body limit). The case id travels as clientPayload.
 */
export async function POST(req: Request) {
  try {
    if (storageMode() !== "blob") throw new HttpError(400, "Blob storage is not configured; use local upload");
    const body = (await req.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const user = await requireRole(["analyst"]);
        const caseId = Number(JSON.parse(clientPayload ?? "{}").caseId);
        await getEditableCase(caseId, user);
        if (!allowedMime(pathname)) throw new HttpError(400, "File type not accepted");
        if (!pathname.startsWith(`cases/${caseId}/`)) throw new HttpError(400, "Invalid upload path");
        return {
          allowedContentTypes: [...new Set(Object.values(ALLOWED_TYPES))],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + 10 * 60 * 1000,
          tokenPayload: JSON.stringify({ caseId, userId: user.id }),
        };
      },
      // Documents are registered explicitly by the browser after upload (POST /api/cases/[id]/documents).
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
