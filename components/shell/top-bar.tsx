import Link from "next/link";
import { FileText } from "lucide-react";
import type { SessionUser } from "@/lib/auth/guard";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";

const ROLE_LABEL = { analyst: "L2 Analyst", qa: "QA reviewer", admin: "Admin" } as const;

function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

export function TopBar({ user }: { user: SessionUser }) {
  const links = [
    { href: "/cases", label: "My cases", show: true },
    { href: "/dashboard", label: "Dashboard", show: true },
    { href: "/qa", label: "QA review", show: user.role !== "analyst" },
    { href: "/admin", label: "Admin settings", show: user.role === "admin" },
  ].filter((l) => l.show);

  return (
    <header className="bg-topbar text-white">
      <div className="mx-auto flex min-h-14 max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 md:px-10">
        <Link href="/cases" className="flex items-center gap-2.5 text-[15px] font-semibold">
          <FileText className="size-5" aria-hidden />
          TM Summary Drafter
        </Link>
        <NavLinks links={links} />
        <div className="ml-auto flex items-center gap-4 text-[13px]">
          {/* CaseTimer portals into this slot on case pages. */}
          <div id="topbar-timer" />
          <span className="text-white/90">
            {shortName(user.name)} · {ROLE_LABEL[user.role]}
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
