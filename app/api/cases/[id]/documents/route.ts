import { NextResponse } from "next/server";
import { z } from "zod";
import { ALL_ROLES, getCaseForUser, getEditableCase, requireRole } from "@/lib/auth/guard";
import { idParam, parseBody, route } from "@/lib/http";
import { listDocuments, registerDocument } from "@/lib/documents/service";

type Ctx = { params: Promise<{ id: string }> };

// Parsing runs after the response (Gemini calls can take a while); the UI polls the list.
export const maxDuration = 300;

export const GET = route(async (_req, { params }: Ctx) => {
  const user = await requireRole(ALL_ROLES);
  const c = await getCaseForUser(idParam((await params).id), user);
  return NextResponse.json({ documents: await listDocuments(c.id) });
});

const Register = z.object({
  blobUrl: z.string().min(1).max(2000),
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});

export const POST = route(async (req, { params }: Ctx) => {
  const user = await requireRole(["analyst"]);
  const c = await getEditableCase(idParam((await params).id), user);
  const body = await parseBody(req, Register);
  const doc = await registerDocument(c.id, user, body);
  return NextResponse.json({ id: doc.id }, { status: 201 });
});
