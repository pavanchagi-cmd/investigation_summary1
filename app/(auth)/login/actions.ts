"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export async function login(_prev: string | null, formData: FormData): Promise<string | null> {
  const next = String(formData.get("next") ?? "/cases");
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: next.startsWith("/") && !next.startsWith("//") ? next : "/cases",
    });
    return null;
  } catch (err) {
    if (err instanceof AuthError) return "Email or password is incorrect.";
    throw err; // redirect() after successful sign-in
  }
}
