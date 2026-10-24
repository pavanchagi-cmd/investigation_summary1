import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { route } from "@/lib/http";
import { purgeOldCases } from "@/lib/admin/purge";

export const POST = route(async () => {
  const user = await requireRole(["admin"]);
  return NextResponse.json(await purgeOldCases(user.id));
});
