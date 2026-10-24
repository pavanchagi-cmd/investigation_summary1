import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { parseBody, route } from "@/lib/http";
import { CONFIG_KEYS, getConfig, setConfigValue, type ConfigKey } from "@/lib/config";

export const GET = route(async () => {
  await requireRole(["admin"]);
  return NextResponse.json({ config: await getConfig() });
});

const Put = z.object({ key: z.enum(CONFIG_KEYS as [ConfigKey, ...ConfigKey[]]), value: z.unknown() });

/** Thresholds, weights, country and institution lists, FX rates, baseline, retention. Validated per key. */
export const PUT = route(async (req) => {
  const user = await requireRole(["admin"]);
  const { key, value } = await parseBody(req, Put);
  return NextResponse.json({ value: await setConfigValue(key, value, user.id) });
});
