"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { setupProblems } from "@/lib/setup-check";

export async function login(_prev: string | null, formData: FormData): Promise<string | null> {
  const next = String(formData.get("next") ?? "/cases");
  const problems = await setupProblems();
  if (problems.length) return `Sign-in is not available yet: ${problems.join(" ")}`;
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: next.startsWith("/") && !next.startsWith("//") ? next : "/cases",
    });
    return null;
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.type === "CredentialsSignin") return "Email or password is incorrect.";
      console.error(`[auth] sign-in failed: ${err.type}`);
      return "Sign-in failed because of a server configuration problem. Check AUTH_SECRET and the database connection in Vercel.";
    }
    throw err; // redirect() after successful sign-in
  }
}
