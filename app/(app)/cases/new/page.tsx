import { redirect } from "next/navigation";
import { requireRole, ALL_ROLES } from "@/lib/auth/guard";
import { NewCaseForm } from "./new-case-form";

export const metadata = { title: "New investigation summary · TM Summary Drafter" };

export default async function NewCasePage() {
  const user = await requireRole(ALL_ROLES);
  if (user.role !== "analyst") redirect("/cases");
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-8 md:px-10">
      <h1 className="text-[24px] font-semibold">New investigation summary</h1>
      <p className="mt-1 text-[14px] text-muted">Enter the alert number to start. The case timer starts when the alert is loaded.</p>
      <div className="mt-6 max-w-[720px] rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-4 text-[18px] font-semibold">Q1 · Alert number</h2>
        <NewCaseForm />
      </div>
    </div>
  );
}
