import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { auth } from "@/auth";
import { setupProblems, setupWarnings } from "@/lib/setup-check";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · TM Summary Drafter" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // auth() throws when AUTH_SECRET is missing; the setup panel below explains what to fix.
  const session = await auth().catch(() => null);
  const problems = await setupProblems();
  const warnings = setupWarnings();
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
        {problems.length ? (
          <div role="alert" className="mb-5 rounded-md border border-risk/30 bg-risk-soft px-4 py-3 text-[13px] text-risk">
            <p className="font-semibold">Setup incomplete</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {warnings.length ? (
          <div role="status" className="mb-5 rounded-md border border-ai/30 bg-ai-soft px-4 py-3 text-[13px] text-ai">
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        ) : null}
        <LoginForm next={safeNext} />
        <p className="mt-6 text-[12.5px] leading-relaxed text-muted">
          Demo environment with synthetic data only. Do not upload real customer data.
        </p>
      </div>
    </main>
  );
}
