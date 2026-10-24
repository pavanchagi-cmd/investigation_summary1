import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/audit/log", () => ({ logAudit: vi.fn(async () => {}) }));

/** Optional live smoke test: RUN_LIVE_LLM=1 GEMINI_API_KEY=… npx vitest run tests/unit/live-llm.test.ts */
describe.skipIf(process.env.RUN_LIVE_LLM !== "1")("live Gemini smoke test", () => {
  it("returns schema-valid structured output with synthetic input", async () => {
    process.env.GEMINI_MOCK = "0";
    const { callGemini } = await import("@/lib/llm/gemini");
    const res = await callGemini({
      task: "classification",
      schema: z.object({ type: z.enum(["alert_report", "transaction_list", "kyc_profile", "counterparty_details", "case_history", "rfi_response", "other"]), confidence: z.number(), reason: z.string() }),
      systemInstruction: "Classify the synthetic document into one type.",
      parts: [{ text: "Customer Due Diligence Profile. Client name: Example Co (fictional). CIF 000. Risk rating: Low." }],
      promptVersion: "smoke@1",
      caseId: null,
      actorId: null,
    });
    expect(res.data.type).toBe("kyc_profile");
  }, 90_000);
});
