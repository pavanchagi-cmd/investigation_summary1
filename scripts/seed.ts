/* Idempotent seed: demo users, default config and dashboard history. Never overwrites existing rows. */
import "./load-env";
import { getDbForEnv } from "../lib/db/client";
import { seedDatabase } from "../lib/seed/run";

async function main() {
  const db = await getDbForEnv();
  const summary = await seedDatabase(db, { password: process.env.SEED_USER_PASSWORD });
  console.log(`Seed complete: ${JSON.stringify(summary)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`Seed failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
