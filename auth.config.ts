import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/lib/db/schema";

/** Edge-safe part of the Auth.js config (used by middleware). Providers live in auth.ts. */
export const authConfig = {
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [],
  callbacks: {
    // Redirects are handled in middleware.ts; route handlers answer 401/403 themselves.
    authorized: () => true,
    jwt({ token, user }) {
      if (user) {
        token.uid = Number(user.id);
        token.role = (user as { role: Role }).role;
        token.permissions = (user as { permissions?: string[] }).permissions ?? [];
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = String(token.uid);
      session.user.role = token.role as Role;
      session.user.permissions = (token.permissions as string[]) ?? [];
      return session;
    },
  },
} satisfies NextAuthConfig;
