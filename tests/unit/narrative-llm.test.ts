import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { docSections, docToText, replaceSection, sectionsToDoc, headingText } from "@/lib/narrative/doc";
import { diffDocs } from "@/lib/narrative/diff";
import {
  AlertReportExtraction,
  Classification,
  KycExtraction,
  NarrativeOutput,
  RelationshipSummary,
  RfiExtraction,
  SECTION_KEYS,
} from "@/lib/llm/schemas";
import { mockNarrative, mockQ5 } from "@/lib/llm/mock-generators";
import { describeAudit } from "@/lib/audit/describe";

vi.mock("@/lib/audit/log", () => ({ logAudit: vi.fn(async () => {}) }));

const sections = SECTION_KEYS.map((key) => ({ key, body: `Body of ${key}. Second sentence for ${key}.` }));

describe("narrative document", () => {
  it("builds TipTap JSON with the fixed headings and reads it back per section", () => {
    const doc = sectionsToDoc(sections);
    const parsed = docSections(doc);
    expect(parsed.map((s) => s.key)).toEqual([...SECTION_KEYS]);
    expect(parsed[0].heading).toBe("1. Alert overview");
    expect(parsed[7].heading).toBe("8. Points for analyst decision");
    expect(docToText(doc)).toContain("3. ACTIVITY IN THE REVIEW PERIOD\n\nBody of activity_summary.");
  });

  it("turns '- ' lines into a bullet list", () => {
    const doc = sectionsToDoc([{ key: "information_gaps", body: "- industry code\n- invoices for Aurelia" }]);
    expect(doc.content.some((n) => n.type === "bulletList")).toBe(true);
  });

  it("regenerating a section replaces only that section", () => {
    const doc = sectionsToDoc(sections);
    const next = replaceSection(doc, "red_flags", "New red flags text.");
    const before = docSections(doc);
    const after = docSections(next);
    expect(after.find((s) => s.key === "red_flags")!.text).toBe("New red flags text.");
    for (const k of SECTION_KEYS.filter((k) => k !== "red_flags")) {
      expect(after.find((s) => s.key === k)!.text).toBe(before.find((s) => s.key === k)!.text);
    }
    expect(headingText("red_flags")).toBe("5. Red flags identified");
  });
});

describe("diff and % AI text kept", () => {
  it("counts word insertions and deletions per section", () => {
    const ai = sectionsToDoc([{ key: "activity_summary", body: "Activity is consistent with seasonal trade." }]);
    const edited = sectionsToDoc([{ key: "activity_summary", body: "Activity is not consistent with seasonal trade per the RFI." }]);
    const d = diffDocs(ai, edited);
    expect(d.added).toBe(5); // not, trade, per, the, RFI.
    expect(d.removed).toBe(1); // "trade." became "trade"
    const act = d.sections.find((s) => s.heading.startsWith("3."))!;
    expect(act.added).toBe(5);
    expect(d.pctKept).toBeGreaterThan(80);
    expect(d.pctKept).toBeLessThan(100);
  });

  it("an unchanged draft keeps 100%", () => {
    const ai = sectionsToDoc(sections);
    expect(diffDocs(ai, ai)).toMatchObject({ added: 0, removed: 0, pctKept: 100 });
  });
});

describe("LLM schemas", () => {
  it("narrative output must contain each of the 8 sections exactly once", () => {
    const ok = { sections: SECTION_KEYS.map((key) => ({ key, heading: key, body: "x" })) };
    expect(NarrativeOutput.safeParse(ok).success).toBe(true);
    expect(NarrativeOutput.safeParse({ sections: ok.sections.slice(1) }).success).toBe(false);
    expect(NarrativeOutput.safeParse({ sections: [...ok.sections, ok.sections[0]] }).success).toBe(false);
  });

  it("relationship summary caps the summary length and enumerates the tags", () => {
    const base = { counterpartyId: 1, relationshipType: "supplier", relationshipSubtype: null, purpose: "p", kycFit: "fits", summary: "s", sources: [] };
    expect(RelationshipSummary.safeParse(base).success).toBe(true);
    expect(RelationshipSummary.safeParse({ ...base, summary: "x".repeat(601) }).success).toBe(false);
    expect(RelationshipSummary.safeParse({ ...base, relationshipType: "friend" }).success).toBe(false);
  });

  it("classification rejects unknown document types", () => {
    expect(Classification.safeParse({ type: "kyc_profile", confidence: 0.9, reason: "r" }).success).toBe(true);
    expect(Classification.safeParse({ type: "passport", confidence: 0.9, reason: "r" }).success).toBe(false);
  });

  it("every recorded extraction fixture validates against its schema", () => {
    const dir = path.join(process.cwd(), "seed", "fixtures", "extraction");
    const schemas: Record<string, z.ZodType> = { alert_report: AlertReportExtraction, kyc_profile: KycExtraction, rfi_response: RfiExtraction };
    const files = fs.readdirSync(dir);
    expect(files.length).toBeGreaterThanOrEqual(16);
    for (const f of files) {
      const type = f.split("__")[0];
      if (!schemas[type]) continue;
      const res = schemas[type].safeParse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      expect(res.success, f).toBe(true);
    }
  });

  it("generates a JSON schema without unsupported keywords", async () => {
    const { toResponseSchema } = await import("@/lib/llm/gemini");
    const json = JSON.stringify(toResponseSchema(RelationshipSummary));
    expect(json).not.toContain("$schema");
    expect(json).not.toContain("maxLength");
    expect(json).toContain("relationshipType");
  });
});

describe("Gemini wrapper (mock mode)", () => {
  it("returns validated fixture data and never needs a key", async () => {
    const { callGemini } = await import("@/lib/llm/gemini");
    delete process.env.GEMINI_API_KEY;
    const res = await callGemini({
      task: "extraction",
      schema: KycExtraction,
      systemInstruction: "x",
      parts: [{ text: "y" }],
      promptVersion: "test@1",
      caseId: null,
      actorId: null,
      mockKey: "kyc_profile__kyc_profile_CIF10048832.pdf",
    });
    expect(res.data.client_name.value).toBe("Kestrel Trading Pvt Ltd");
    expect(res.data.industry_code.value).toBeNull();
    expect(res.model).toMatch(/^mock:/);
  });

  it("the mock narrative never states a disposition and treats dismissed findings as dismissed", () => {
    const out = mockNarrative({
      alert: { alert_number: "ALR-2026-000123", alert_date: "2026-10-02" },
      sub_alerts: [],
      review_period: { start: "2026-07-01", end: "2026-09-30", in_period_txn_count: 312, total_flow: 4142880, currency: "USD", excluded_txn_count: 18 },
      client_kyc: { client_name: "Kestrel Trading Pvt Ltd" },
      counterparties_top6: [],
      relationship_summaries: [],
      scenario_findings: [{ scenario: "large_amount", summary: "s", matched_count: 3, dismissed: true, dismiss_reason: "Invoices on file" }],
    });
    expect(NarrativeOutput.safeParse(out).success).toBe(true);
    const text = out.sections.map((s) => s.body).join(" ");
    expect(text).toContain('dismissed by the analyst: "Invoices on file"');
    expect(text).not.toMatch(/we recommend|should be escalated|should be closed/i);
  });

  it("mock Q5 summaries stay within the schema", () => {
    const out = mockQ5({
      client_kyc: { expected_activity: { countries: ["IN"] } },
      counterparties: [
        {
          counterpartyId: 7,
          name: "Pinewood Textiles",
          direction_relative_to_client: "receives funds from the client",
          country: "IN",
          txn_count: 22,
          total_amount: 410300,
          currency: "USD",
          pct_of_client_flow: 9.9,
          first_date: "2026-07-04",
          last_date: "2026-09-28",
          risk_flags: ["WS-04"],
          scenario_links: [{ scenario: "wire_structuring", dismissed: false, matched_txns_with_this_counterparty: 7 }],
          reference_texts: [{ text: "Fabric order 1", count: 1 }],
          stated_relationship: null,
          rfi_answers: [],
          transaction_source: "transactions_Q3.xlsx · rows 32–330",
        },
      ],
    });
    expect(out.summaries).toHaveLength(1);
    expect(RelationshipSummary.safeParse(out.summaries[0]).success).toBe(true);
    expect(out.summaries[0].summary).toContain("USD 410,300");
  });
});

describe("audit descriptions", () => {
  it("describes edits like the design's trail", () => {
    expect(
      describeAudit({
        action: "narrative_saved",
        entity: "narrative",
        entityId: "1",
        before: null,
        after: { version: 2, added_words: 14, removed_words: 6, changed_sections: ["3. Activity in the review period", "2. Client profile"] },
        actorName: "Aditi Rao",
      }),
    ).toBe("A. Rao edited §3 and §2 (+14 / −6)");
  });
});
