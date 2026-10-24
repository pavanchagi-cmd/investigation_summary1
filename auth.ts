import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

const LoginInput = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) });

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = LoginInput.safeParse(raw);
        if (!parsed.success) return null;
        const db = await getDb();
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, parsed.data.email.toLowerCase()))
          .limit(1);
        if (!user) return null;
        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        return {
          id: String(user.id),
          name: user.name,
          email: user.email,
          role: user.role,
          permissions: user.permissions,
        };
      },
    }),
  ],
});
