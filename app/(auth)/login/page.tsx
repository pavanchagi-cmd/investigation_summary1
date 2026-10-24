import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { auth } from "@/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · TM Summary Drafter" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await auth();
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/cases";
  if (session?.user) redirect(safeNext);
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[400px] rounded-xl border border-line bg-surface p-8">
        <div className="mb-6 flex items-center gap-2.5">
          <FileText className="size-5 text-accent" aria-hidden />
          <h1 className="text-[18px] font-semibold">TM Summary Drafter</h1>
        </div>
        <LoginForm next={safeNext} />
        <p className="mt-6 text-[12.5px] leading-relaxed text-muted">
          Demo environment with synthetic data only. Do not upload real customer data.
        </p>
      </div>
    </main>
  );
}
