import "server-only";
import { getDbForEnv, type Db } from "./client";

export type { Db } from "./client";

const globalForDb = globalThis as unknown as { __tmDb?: Promise<Db> };

/** Process-wide database handle (Postgres in production, PGlite locally). */
export function getDb(): Promise<Db> {
  if (!globalForDb.__tmDb) {
    globalForDb.__tmDb = getDbForEnv().catch((err) => {
      globalForDb.__tmDb = undefined;
      throw err;
    });
  }
  return globalForDb.__tmDb;
}
