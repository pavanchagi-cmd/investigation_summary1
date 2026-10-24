import "server-only";
import type { Part } from "@google/genai";
import type { ZodType } from "zod";
import type { DocType } from "@/lib/db/schema";
import { callGemini, LlmError } from "@/lib/llm/gemini";
import { loadPrompt, wrapDocument } from "@/lib/llm/prompts";
import {
  AlertReportExtraction,
  CaseHistoryExtraction,
  Classification,
  CounterpartyDetailsExtraction,
  KycExtraction,
  OtherExtraction,
  RfiExtraction,
  TransactionTableExtraction,
} from "@/lib/llm/schemas";

/** Gemini inline-data limit we enforce (spec section 9: files above 20 MB are rejected). */
export const MAX_INLINE_BYTES = 20 * 1024 * 1024;

export const EXTRACTION_SCHEMAS: Record<DocType, ZodType> = {
  alert_report: AlertReportExtraction,
  kyc_profile: KycExtraction,
  case_history: CaseHistoryExtraction,
  rfi_response: RfiExtraction,
  counterparty_details: CounterpartyDetailsExtraction,
  transaction_list: TransactionTableExtraction,
  other: OtherExtraction,
};

export type DocInput =
  | { kind: "inline"; fileName: string; mimeType: string; data: Buffer }
  | { kind: "text"; fileName: string; text: string };

function partsFor(input: DocInput, task: string): Part[] {
  if (input.kind === "inline") {
    if (input.data.length > MAX_INLINE_BYTES) {
      throw new LlmError(`${input.fileName} is larger than 20 MB. Split it into smaller files and upload again.`);
    }
    // Passed inline (no Files API), so nothing is stored at Google beyond the request.
    return [
      { text: `File name: ${input.fileName}\n${task}` },
      { inlineData: { mimeType: input.mimeType, data: input.data.toString("base64") } },
    ];
  }
  return [{ text: `${task}\n\n${wrapDocument(input.fileName, input.text)}` }];
}

export async function extractDocument(
  type: DocType,
  input: DocInput,
  ctx: { caseId: number; actorId: number | null },
): Promise<{ data: unknown; model: string; promptVersion: string }> {
  const system = loadPrompt("extract-system");
  const task = loadPrompt(`extract-${type}`);
  const res = await callGemini({
    task: "extraction",
    schema: EXTRACTION_SCHEMAS[type],
    systemInstruction: system.text,
    parts: partsFor(input, task.text),
    promptVersion: `${system.version}+${task.version}`,
    caseId: ctx.caseId,
    actorId: ctx.actorId,
    mockKey: `${type}__${input.fileName}`,
  });
  return res;
}

export async function classifyDocument(input: DocInput, ctx: { caseId: number; actorId: number | null }) {
  const prompt = loadPrompt("classify");
  const res = await callGemini({
    task: "classification",
    schema: Classification,
    systemInstruction: prompt.text,
    parts: partsFor(input, "Classify this document."),
    promptVersion: prompt.version,
    caseId: ctx.caseId,
    actorId: ctx.actorId,
    mockKey: input.fileName,
  });
  return res.data;
}
