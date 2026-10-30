import "server-only";
import crypto from "node:crypto";
import { GoogleGenAI, type Part } from "@google/genai";
import { z, type ZodType } from "zod";
import { logAudit } from "@/lib/audit/log";
import { HttpError } from "@/lib/http";
import { mockResponse } from "./mock";

/**
 * The only place the app talks to Gemini (spec section 9). Server-only: the key never reaches
 * the browser bundle. Every call uses structured output validated with Zod and is audit-logged
 * with model, prompt version and input hash – never with prompt or response contents.
 */

export type LlmTask = "extraction" | "classification" | "q5_summaries" | "narrative" | "narrative_section";

/** A failed Gemini call. An HttpError (502), so API routes return its readable message to the browser. */
export class LlmError extends HttpError {
  constructor(
    message: string,
    public readonly retryable = false,
  ) {
    super(502, message);
    this.name = "LlmError";
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
const MAX_TRANSPORT_RETRIES = 3;

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
  const raw = z.toJSONSchema(schema, { unrepresentable: "any", io: "input" });
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
  return simplify(clean(raw));
}

const SAFE_INT = Number.MAX_SAFE_INTEGER;

/**
 * Shrinks the schema Gemini has to compile (large schemas are rejected with a 400): drops Zod's
 * default ±MAX_SAFE_INTEGER bounds and turns anyOf [X, null] into a nullable type list.
 */
function simplify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simplify);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if ((k === "minimum" && v === -SAFE_INT) || (k === "maximum" && v === SAFE_INT)) continue;
    out[k] = simplify(v);
  }
  const any = out.anyOf as Record<string, unknown>[] | undefined;
  if (Array.isArray(any) && any.length === 2) {
    const nullIdx = any.findIndex((x) => x && x.type === "null" && Object.keys(x).length === 1);
    const other = any[1 - nullIdx];
    if (nullIdx >= 0 && other && typeof other.type === "string" && !other.properties && !other.items && !other.anyOf) {
      delete out.anyOf;
      Object.assign(out, other, { type: [other.type, "null"] });
    }
  }
  return out;
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

/** Readable reason for a failed call. Google's error text describes the request, never the document. */
export function geminiErrorMessage(status: number | undefined, model: string, err: unknown): string {
  const detail = String((err as Error)?.message ?? "")
    .replace(/\s+/g, " ")
    .slice(0, 200);
  if (status === 429) return "Gemini is rate-limiting requests (429). Wait a minute, then click Retry.";
  if (status === 404) return `Gemini model "${model}" was not found for this key (404). Check GEMINI_MODEL.`;
  if (status === 401 || status === 403) return `Gemini refused the API key (${status}). Check GEMINI_API_KEY in Vercel.`;
  if (status === 400) return `Gemini rejected the request (400): ${detail || "no detail given"}`;
  if (status != null && status >= 500) return `Gemini is overloaded or unavailable (${status}) after 4 attempts. Click Retry in a minute.`;
  if (/timed? ?out|abort/i.test(detail)) return `Gemini took longer than ${TIMEOUT_MS / 1000} s, 4 times. Click Retry.`;
  return `Gemini could not be reached${detail ? ` (${detail})` : ""}. Click Retry.`;
}

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
          // No status = network error or timeout: worth another try, like 429 and 5xx.
          const retryable = status == null || status === 429 || status >= 500;
          if (retryable && attempt < MAX_TRANSPORT_RETRIES) {
            await sleep(2000 * 2 ** attempt);
            continue;
          }
          outcome = `error_${status ?? "network"}`;
          throw new LlmError(geminiErrorMessage(status, model, err), retryable);
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
