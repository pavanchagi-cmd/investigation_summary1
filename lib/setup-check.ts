import "server-only";
import { count } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import { databaseUrl } from "@/lib/db/client";
import { getDb } from "@/lib/db";

/**
 * Deployment self-check shown on the login page: names what is missing (never values), so a
 * misconfigured deployment explains itself instead of failing with a generic Auth.js error.
 */
export async function setupProblems(): Promise<string[]> {
  const problems: string[] = [];
  if (!process.env.AUTH_SECRET) {
    problems.push("AUTH_SECRET is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.");
  }
  if (process.env.VERCEL && !databaseUrl()) {
    problems.push("No database is connected (DATABASE_URL / POSTGRES_URL missing). Connect Neon Postgres in the Vercel Storage tab, then redeploy.");
    return problems;
  }
  try {
    const db = await getDb();
    const [{ n }] = await db.select({ n: count() }).from(users);
    if (n === 0) {
      problems.push(
        "No users exist yet. Set SEED_USER_PASSWORD in Vercel → Settings → Environment Variables and redeploy (the build creates the demo users).",
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[setup] database check failed: ${msg}`);
    problems.push(
      /relation .*users.* does not exist/i.test(msg)
        ? "The database tables have not been created. Redeploy so the build runs the migrations."
        : "The database cannot be reached. Check the Postgres connection in the Vercel Storage tab.",
    );
  }
  return problems;
}
