import bcrypt from "bcryptjs";
import type { Db } from "../db/client";
import { users } from "../db/schema";

export const DEMO_USERS = [
  { email: "analyst@demo.local", name: "Aditi Rao", role: "analyst" as const },
  { email: "analyst2@demo.local", name: "Sanjay Iyer", role: "analyst" as const },
  { email: "qa@demo.local", name: "Priya Nair", role: "qa" as const },
  { email: "admin@demo.local", name: "Demo Admin", role: "admin" as const },
];

export type SeedSummary = { usersCreated: number; skippedUsers?: string };

export async function seedDatabase(db: Db, opts: { password?: string }): Promise<SeedSummary> {
  const summary: SeedSummary = { usersCreated: 0 };
  if (!opts.password) {
    summary.skippedUsers = "SEED_USER_PASSWORD is not set; demo users were not created";
    console.warn(summary.skippedUsers);
  } else {
    const hash = await bcrypt.hash(opts.password, 10);
    for (const u of DEMO_USERS) {
      const inserted = await db
        .insert(users)
        .values({ ...u, passwordHash: hash })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id });
      summary.usersCreated += inserted.length;
    }
  }
  return summary;
}
