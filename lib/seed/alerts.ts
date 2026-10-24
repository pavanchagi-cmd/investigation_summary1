import { buildAlert123 } from "./alert-123";
import { buildAlert101, buildAlert102, buildAlert103 } from "./alert-simple";
import type { SeedAlert } from "./types";

/** The four synthetic demo alerts, one per scenario (spec section 14). */
export function buildSeedAlerts(): SeedAlert[] {
  return [buildAlert101(), buildAlert102(), buildAlert103(), buildAlert123()];
}
