import fs from "node:fs/promises";
import path from "node:path";
import type { LlmTask } from "./gemini";

/**
 * GEMINI_MOCK=1 responses for tests, CI and local demos without a key (DECISIONS D7).
 * Extraction/classification read fixtures from seed/fixtures; Q5 and narrative fixtures are
 * produced deterministically from the call's structured input.
 */
export async function mockResponse(task: LlmTask, key: string | undefined, input: unknown): Promise<unknown> {
  if (task === "extraction" || task === "classification") {
    const file = key ? path.join(process.cwd(), "seed", "fixtures", `${task}`, `${safe(key)}.json`) : null;
    if (file) {
      try {
        return JSON.parse(await fs.readFile(file, "utf8"));
      } catch {
        /* fall through */
      }
    }
    if (task === "classification") return { type: "other", confidence: 0.2, reason: "Mock mode: no recorded classification for this file." };
    throw new Error("Mock mode: no recorded extraction fixture for this document.");
  }
  const { mockQ5, mockNarrative, mockNarrativeSection } = await import("./mock-generators");
  if (task === "q5_summaries") return mockQ5(input);
  if (task === "narrative") return mockNarrative(input);
  return mockNarrativeSection(input);
}

function safe(key: string) {
  return key.replace(/[^\w.\-]+/g, "_");
}
