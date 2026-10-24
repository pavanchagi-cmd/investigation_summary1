import "server-only";
import crypto from "node:crypto";
import { GoogleGenAI, type Part } from "@google/genai";
import { z, type ZodType } from "zod";
import { logAudit } from "@/lib/audit/log";
import { mockResponse } from "./mock";

/**
 * The only place the app talks to Gemini (spec section 9). Server-only: the key never reaches
 * the browser bundle. Every call uses structured output validated with Zod and is audit-logged
 * with model, prompt version and input hash – never with prompt or response contents.
 */

export type LlmTask = "extraction" | "classification" | "q5_summaries" | "narrative" | "narrative_section";

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

export type CallInput<T> = {
  task: LlmTask;
  schema: ZodType<T>;
  systemInstruction: string;
  parts: Part[];
  promptVersion: string;
  /** Override model (narrative uses GEMINI_NARRATIVE_MODEL when set). */
  model?: string;
  caseId: number | null;
  actorId: number | null;
  /** Fixture key for GEMINI_MOCK mode (e.g. the document file name). */
  mockKey?: string;
  /** Structured input for mock generators (Q5 / narrative). */
  mockInput?: unknown;
};

export type CallResult<T> = { data: T; model: string; promptVersion: string; inputHash: string };

const TIMEOUT_MS = 60_000;
const MAX_TRANSPORT_RETRIES = 2;

export function isMock() {
  return process.env.GEMINI_MOCK === "1";
}

export function defaultModel(task?: LlmTask) {
  if ((task === "narrative" || task === "narrative_section") && process.env.GEMINI_NARRATIVE_MODEL) {
    return process.env.GEMINI_NARRATIVE_MODEL;
  }
  return process.env.GEMINI_MODEL || "gemini-3.5-flash";
}

let client: GoogleGenAI | null = null;

/** GEMINI_BACKEND=developer (API key) or agent_platform (Agent Platform / Vertex, fixed region). */
export function getClient(): GoogleGenAI {
  if (client) return client;
  const backend = process.env.GEMINI_BACKEND ?? "developer";
  if (backend === "agent_platform") {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.GOOGLE_CLOUD_LOCATION;
    if (!project || !location) throw new LlmError("GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION must be set for agent_platform");
    client = new GoogleGenAI({ vertexai: true, project, location });
  } else {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new LlmError("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

const ALLOWED_SCHEMA_KEYS = new Set([
  "type", "properties", "required", "items", "enum", "anyOf", "description", "format", "minimum", "maximum",
  "minItems", "maxItems", "additionalProperties", "$defs", "$ref", "title", "prefixItems",
]);

/** Zod → JSON Schema restricted to the keywords Gemini's responseJsonSchema accepts. */
export function toResponseSchema(schema: ZodType): unknown {
  const raw = z.toJSONSchema(schema, { unrepresentable: "any" });
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (!ALLOWED_SCHEMA_KEYS.has(k)) continue;
      if (k === "properties" || k === "$defs") {
        out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, clean(pv)]));
      } else if (k === "format" && !["date", "date-time"].includes(String(v))) {
        continue;
      } else out[k] = clean(v);
    }
    return out;
  };
  return clean(raw);
}

export function hashInput(systemInstruction: string, parts: Part[]): string {
  const h = crypto.createHash("sha256");
  h.update(systemInstruction);
  for (const p of parts) {
    if (p.text) h.update(p.text);
    if (p.inlineData?.data) h.update(p.inlineData.data);
  }
  return h.digest("hex");
}

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; code?: number };
  return typeof e?.status === "number" ? e.status : typeof e?.code === "number" ? e.code : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function callGemini<T>(input: CallInput<T>): Promise<CallResult<T>> {
  const model = input.model ?? defaultModel(input.task);
  const inputHash = hashInput(input.systemInstruction, input.parts);
  const started = Date.now();
  let usage: { prompt?: number; output?: number } = {};
  let outcome = "ok";
  try {
    if (isMock()) {
      const raw = await mockResponse(input.task, input.mockKey, input.mockInput);
      const data = input.schema.parse(raw);
      return { data, model: `mock:${model}`, promptVersion: input.promptVersion, inputHash };
    }
    const ai = getClient();
    const config = {
      systemInstruction: input.systemInstruction,
      responseMimeType: "application/json",
      responseJsonSchema: toResponseSchema(input.schema),
      temperature: 0.2,
      httpOptions: { timeout: TIMEOUT_MS },
    };
    let contents: Part[] = input.parts;
    for (let validationAttempt = 0; ; validationAttempt++) {
      let text: string | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await ai.models.generateContent({ model, contents: [{ role: "user", parts: contents }], config });
          usage = {
            prompt: res.usageMetadata?.promptTokenCount,
            output: res.usageMetadata?.candidatesTokenCount,
          };
          text = res.text;
          break;
        } catch (err) {
          const status = statusOf(err);
          const retryable = status === 429 || (status != null && status >= 500) || (err as Error)?.name === "AbortError";
          if (retryable && attempt < MAX_TRANSPORT_RETRIES) {
            await sleep(1000 * 2 ** attempt);
            continue;
          }
          outcome = `error_${status ?? "network"}`;
          throw new LlmError(
            status === 429
              ? "Gemini is rate-limiting requests. Please try again in a minute."
              : status === 404
                ? `Gemini model "${model}" was not found for this key. Check GEMINI_MODEL.`
                : "Gemini did not respond. Please try again.",
            retryable,
          );
        }
      }
      let json: unknown;
      try {
        json = JSON.parse(text ?? "");
      } catch {
        json = undefined;
      }
      const parsed = input.schema.safeParse(json);
      if (parsed.success) return { data: parsed.data, model, promptVersion: input.promptVersion, inputHash };
      if (validationAttempt >= 1) {
        outcome = "invalid_output";
        throw new LlmError("Gemini returned output in an unexpected format twice. Please try again.");
      }
      const problems = parsed.error ? parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`) : ["not valid JSON"];
      contents = [...input.parts, { text: `Your previous answer did not match the required schema: ${problems.join("; ")}. Return corrected JSON only.` }];
    }
  } catch (err) {
    if (outcome === "ok") outcome = err instanceof LlmError ? "error" : "invalid_output";
    throw err instanceof LlmError ? err : new LlmError("The AI output could not be validated. Please try again.");
  } finally {
    await logAudit({
      caseId: input.caseId,
      actorId: input.actorId,
      action: "ai_call",
      entity: "llm",
      entityId: input.task,
      after: {
        task: input.task,
        model: isMock() ? `mock:${model}` : model,
        prompt_version: input.promptVersion,
        input_hash: inputHash,
        latency_ms: Date.now() - started,
        prompt_tokens: usage.prompt ?? null,
        output_tokens: usage.output ?? null,
        outcome,
      },
    }).catch(() => {});
  }
}

/** Admin "Check Gemini connection": confirms the key can see the configured model. */
export async function checkConnection(): Promise<{ ok: boolean; model: string; message: string }> {
  const model = defaultModel();
  if (isMock()) return { ok: true, model, message: "Mock mode (GEMINI_MOCK=1): no live call made." };
  try {
    const info = await getClient().models.get({ model });
    return { ok: true, model, message: `Connected. Model available: ${info.displayName ?? info.name ?? model}` };
  } catch (err) {
    const status = statusOf(err);
    const message =
      err instanceof LlmError
        ? err.message
        : status === 404
          ? `Model "${model}" is not available for this key. Set GEMINI_MODEL to a model listed in Google AI Studio.`
          : status === 400 || status === 401 || status === 403
            ? "The key was rejected. Check GEMINI_API_KEY in the Vercel environment variables."
            : "Could not reach Gemini.";
    return { ok: false, model, message };
  }
}
