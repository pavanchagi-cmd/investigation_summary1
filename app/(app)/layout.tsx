import { redirect } from "next/navigation";
import { TopBar } from "@/components/shell/top-bar";
import { requireRole, ALL_ROLES } from "@/lib/auth/guard";
import { HttpError } from "@/lib/http";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(ALL_ROLES).catch((e) => {
    if (e instanceof HttpError) redirect("/login");
    throw e;
  });
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <TopBar user={user} />
      <main id="main">{children}</main>
    </>
  );
}
