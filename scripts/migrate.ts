/* Applies Drizzle migrations to DATABASE_URL (or the local PGlite database). */
import "./load-env";
import { MIGRATIONS_DIR, openPglite } from "../lib/db/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.VERCEL) throw new Error("DATABASE_URL is not set. Connect Neon Postgres in the Vercel Storage tab.");
    await openPglite(process.env.PGLITE_DIR ?? ".data/pglite"); // migrates on open
    console.log("Migrated local PGlite database (.data/pglite)");
    return;
  }
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const client = postgres(url, { max: 1, prepare: false });
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
  await client.end();
  console.log("Migrations applied");
}

main().catch((err) => {
  console.error(`Migration failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
