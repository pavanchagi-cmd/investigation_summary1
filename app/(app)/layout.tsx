import { redirect } from "next/navigation";
import { TopBar } from "@/components/shell/top-bar";
import { requireRole, ALL_ROLES } from "@/lib/auth/guard";
import { HttpError } from "@/lib/http";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(ALL_ROLES).catch((e) => {
    if (e instanceof HttpError) redirect("/login");
    throw e;
  });
  // The display name can be changed by an admin; read it fresh rather than from the sign-in token.
  const [row] = await (await getDb()).select({ name: users.name }).from(users).where(eq(users.id, user.id)).limit(1);
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <TopBar user={{ ...user, name: row?.name ?? user.name }} />
      <main id="main">{children}</main>
    </>
  );
}
