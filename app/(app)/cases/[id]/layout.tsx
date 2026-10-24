import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { ALL_ROLES, getCaseForUser, requireRole } from "@/lib/auth/guard";
import { HttpError } from "@/lib/http";
import { getDb } from "@/lib/db";
import { caseFields, documents } from "@/lib/db/schema";
import { getProgress } from "@/lib/cases/progress";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { CaseTimer } from "@/components/case/case-timer";
import { Stepper } from "@/components/case/stepper";
import { SaveIndicator, SaveStatusProvider } from "@/components/case/save-status";
import { DocumentPreviewProvider } from "@/components/case/document-preview";

export default async function CaseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const user = await requireRole(ALL_ROLES);
  const { id } = await params;
  const c = await getCaseForUser(Number(id), user).catch((e) => {
    if (e instanceof HttpError && (e.status === 404 || e.status === 400)) notFound();
    if (e instanceof HttpError && e.status === 401) redirect("/login");
    throw e;
  });
  const db = await getDb();
  const [nameField] = await db
    .select()
    .from(caseFields)
    .where(and(eq(caseFields.caseId, c.id), eq(caseFields.question, "q3"), eq(caseFields.fieldKey, "client_name")));
  const clientName = (nameField?.analystValue ?? nameField?.aiValue) as string | null | undefined;
  const docs = await db
    .select({ id: documents.id, fileName: documents.fileName, mimeType: documents.mimeType })
    .from(documents)
    .where(eq(documents.caseId, c.id));
  const progress = await getProgress(c);

  return (
    <SaveStatusProvider>
      <DocumentPreviewProvider caseId={c.id} documents={docs}>
        <CaseTimer
          caseId={c.id}
          startedAt={c.startedAt.toISOString()}
          approvedAt={c.approvedAt?.toISOString() ?? null}
          activeSeconds={c.activeSeconds}
          canBeat={user.role === "analyst" && c.createdBy === user.id}
        />
        <div className="border-b border-line bg-surface">
          <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-10">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <h1 className="text-[24px] font-semibold">{clientName || "New investigation summary"}</h1>
              <span className="font-mono text-[14px] text-muted">
                {c.alertNumber}
                {c.reviewStart && c.reviewEnd
                  ? ` · ${formatDate(c.reviewStart, false)} – ${formatDate(c.reviewEnd)}`
                  : ""}
              </span>
              <Badge tone={c.status === "approved" ? "ok" : "accent"}>{c.status === "approved" ? "Approved · locked" : "Drafting"}</Badge>
              <span className="ml-auto">
                <SaveIndicator />
              </span>
            </div>
            {user.role === "analyst" ? <Stepper caseId={c.id} done={progress.stepsDone} /> : null}
          </div>
        </div>
        <div className="mx-auto max-w-[1440px] px-4 py-8 md:px-10">{children}</div>
      </DocumentPreviewProvider>
    </SaveStatusProvider>
  );
}
