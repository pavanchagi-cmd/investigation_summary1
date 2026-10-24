import { LogOut } from "lucide-react";
import { signOut } from "@/auth";

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button type="submit" className="rounded p-1 text-white/70 hover:text-white" aria-label="Sign out" title="Sign out">
        <LogOut className="size-4" />
      </button>
    </form>
  );
}
