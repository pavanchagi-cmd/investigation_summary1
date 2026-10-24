import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { roleEnum, users } from "@/lib/db/schema";
import { HttpError, parseBody, route } from "@/lib/http";
import { logAudit } from "@/lib/audit/log";

export const GET = route(async () => {
  await requireRole(["admin"]);
  const db = await getDb();
  const rows = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, permissions: users.permissions }).from(users);
  return NextResponse.json({ users: rows });
});

const Patch = z.object({
  id: z.number().int().positive(),
  role: z.enum(roleEnum.enumValues).optional(),
  viewFullAccount: z.boolean().optional(),
});

export const PATCH = route(async (req) => {
  const admin = await requireRole(["admin"]);
  const body = await parseBody(req, Patch);
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, body.id));
  if (!u) throw new HttpError(404, "User not found");
  if (u.id === admin.id && body.role && body.role !== "admin") throw new HttpError(400, "You cannot remove your own admin role");
  const permissions =
    body.viewFullAccount === undefined
      ? u.permissions
      : body.viewFullAccount
        ? [...new Set([...u.permissions, "view_full_account"])]
        : u.permissions.filter((p) => p !== "view_full_account");
  await db.update(users).set({ role: body.role ?? u.role, permissions }).where(eq(users.id, u.id));
  await logAudit({
    caseId: null,
    actorId: admin.id,
    action: "user_role_changed",
    entity: "user",
    entityId: u.id,
    before: { role: u.role, permissions: u.permissions },
    after: { role: body.role ?? u.role, permissions },
  });
  return NextResponse.json({ ok: true, note: "Role changes apply at the user's next sign-in." });
});
