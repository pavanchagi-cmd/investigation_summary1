import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { route } from "@/lib/http";
import { checkConnection } from "@/lib/llm/gemini";

/** "Check Gemini connection": confirms the key can see GEMINI_MODEL. No prompt content is sent. */
export const POST = route(async () => {
  await requireRole(["admin"]);
  return NextResponse.json(await checkConnection());
});
