import "server-only";
import { notFound, redirect } from "next/navigation";
import { ALL_ROLES, getCaseForUser, requireRole } from "@/lib/auth/guard";
import { HttpError } from "@/lib/http";

/** For the four analyst screens: QA and admin are sent to the read-only review page. */
export async function loadAnalystCase(idParam: string) {
  const user = await requireRole(ALL_ROLES).catch(() => redirect("/login"));
  const id = Number(idParam);
  const c = await getCaseForUser(id, user).catch((e) => {
    if (e instanceof HttpError) notFound();
    throw e;
  });
  if (user.role !== "analyst") redirect(`/cases/${id}/review`);
  return { user, c, readOnly: c.status === "approved" };
}
