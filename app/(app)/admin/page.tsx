import { redirect } from "next/navigation";
import { ALL_ROLES, requireRole } from "@/lib/auth/guard";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { defaultModel, isMock } from "@/lib/llm/gemini";
import { AdminSettings } from "@/components/admin/admin-settings";

export const metadata = { title: "Admin settings · TM Summary Drafter" };

export default async function AdminPage() {
  const user = await requireRole(ALL_ROLES);
  if (user.role !== "admin") redirect("/cases");
  const db = await getDb();
  const [config, list] = await Promise.all([
    getConfig(),
    db.select({ id: users.id, name: users.name, email: users.email, role: users.role, permissions: users.permissions }).from(users),
  ]);
  return (
    <AdminSettings
      config={config}
      users={list}
      selfId={user.id}
      llm={{ model: defaultModel(), backend: process.env.GEMINI_BACKEND ?? "developer", mock: isMock() }}
    />
  );
}
