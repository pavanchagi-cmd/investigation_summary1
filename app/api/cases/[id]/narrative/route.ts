import { NextResponse } from "next/server";
import { z } from "zod";
import { ALL_ROLES, getCaseForUser, getEditableCase, requireRole } from "@/lib/auth/guard";
import { idParam, parseBody, route } from "@/lib/http";
import { SECTION_KEYS } from "@/lib/llm/schemas";
import { DocSchema, generateNarrative, listVersions, regenerateSection, saveAnalystVersion } from "@/lib/narrative/service";
import type { PMDoc } from "@/lib/narrative/doc";

type Ctx = { params: Promise<{ id: string }> };
// Gemini call 4 can take a while; sized for Vercel Hobby (Fluid compute) and Pro.
export const maxDuration = 300;

export const GET = route(async (_req, { params }: Ctx) => {
  const user = await requireRole(ALL_ROLES);
  const c = await getCaseForUser(idParam((await params).id), user);
  const versions = await listVersions(c.id);
  return NextResponse.json({ versions: versions.map((v) => ({ id: v.id, version: v.version, kind: v.kind, createdAt: v.createdAt, model: v.model, promptVersion: v.promptVersion })) });
});

const Generate = z.object({ sectionKey: z.enum(SECTION_KEYS).optional(), confirmReplace: z.boolean().optional() }).default({});

/** Generate the narrative, or (with sectionKey) regenerate one section after the analyst confirmed. */
export const POST = route(async (req, { params }: Ctx) => {
  const user = await requireRole(["analyst"]);
  const c = await getEditableCase(idParam((await params).id), user);
  const body = Generate.parse(await req.json().catch(() => ({})));
  if (body.sectionKey) {
    if (!body.confirmReplace) return NextResponse.json({ error: "Confirm that edits in this section will be replaced" }, { status: 400 });
    const doc = await regenerateSection(c, user, body.sectionKey);
    return NextResponse.json({ doc });
  }
  const row = await generateNarrative(c, user);
  return NextResponse.json({ version: row.version }, { status: 201 });
});

const Save = z.object({ doc: DocSchema });

export const PUT = route(async (req, { params }: Ctx) => {
  const user = await requireRole(["analyst"]);
  const c = await getEditableCase(idParam((await params).id), user);
  const { doc } = await parseBody(req, Save);
  return NextResponse.json(await saveAnalystVersion(c, user, doc as unknown as PMDoc));
});
