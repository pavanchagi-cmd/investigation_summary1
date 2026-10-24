import "server-only";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { cases, type Case, type Role } from "@/lib/db/schema";
import { HttpError } from "@/lib/http";

export type SessionUser = { id: number; name: string; email: string; role: Role; permissions: string[] };

/** The one role check used by every route handler, server action and server page. */
export async function requireRole(roles: Role[]): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) throw new HttpError(401, "Not signed in");
  const user: SessionUser = {
    id: Number(session.user.id),
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    role: session.user.role,
    permissions: session.user.permissions ?? [],
  };
  if (!roles.includes(user.role)) throw new HttpError(403, "Your role cannot do this");
  return user;
}

export const ALL_ROLES: Role[] = ["analyst", "qa", "admin"];

/** Analysts see only their own cases; QA and admin see all. */
export async function getCaseForUser(caseId: number, user: SessionUser): Promise<Case> {
  if (!Number.isInteger(caseId) || caseId <= 0) throw new HttpError(400, "Invalid case id");
  const db = await getDb();
  const [row] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!row) throw new HttpError(404, "Case not found");
  if (user.role === "analyst" && row.createdBy !== user.id) throw new HttpError(404, "Case not found");
  return row;
}

/** Like getCaseForUser, but also refuses edits once the narrative is approved (locked). */
export async function getEditableCase(caseId: number, user: SessionUser): Promise<Case> {
  const row = await getCaseForUser(caseId, user);
  if (row.status === "approved") throw new HttpError(409, "The case is approved and locked. Unlock it to edit.");
  return row;
}

export function canViewFullAccount(user: SessionUser) {
  return user.permissions.includes("view_full_account");
}
