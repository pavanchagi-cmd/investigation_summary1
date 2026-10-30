import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { docSections, docToText, replaceSection, sectionsToDoc, headingText, tidyInlineLists, withDisposition, type PMDoc } from "@/lib/narrative/doc";
import { diffDocs } from "@/lib/narrative/diff";
import {
  AlertReportExtraction,
  Classification,
  KycExtraction,
  NarrativeOutput,
  RelationshipSummary,
  RfiExtraction,
  AI_SECTION_KEYS,
  SECTION_KEYS,
} from "@/lib/llm/schemas";
import { mockNarrative, mockQ5 } from "@/lib/llm/mock-generators";
import { describeAudit } from "@/lib/audit/describe";

vi.mock("@/lib/audit/log", () => ({ logAudit: vi.fn(async () => {}) }));

const sections = AI_SECTION_KEYS.map((key) => ({ key, body: `Body of ${key}. Second sentence for ${key}.` }));

describe("narrative document", () => {
  it("builds TipTap JSON with the fixed headings and reads it back per section", () => {
    const doc = sectionsToDoc(sections);
    const parsed = docSections(doc);
    expect(parsed.map((s) => s.key)).toEqual([...SECTION_KEYS]);
    expect(parsed[0].heading).toBe("1. Alert number and scenarios");
    expect(parsed[1].heading).toBe("2. Transactions with the six counterparties");
    expect(parsed[2].heading).toBe("3. Case decision");
    expect(docToText(doc)).toContain("2. TRANSACTIONS WITH THE SIX COUNTERPARTIES\n\nBody of counterparty_summary.");
  });

  it("section 3 (Case decision) shows only the analyst's decision and saved comments", () => {
    const pending = docSections(sectionsToDoc(sections)).find((s) => s.key === "disposition")!.text;
    expect(pending).toMatch(/^Decision: to be made by the analyst/);
    expect(pending).toMatch(/Analyst comments: none saved yet/);
    for (const [value, word] of [["close_nfa", "Closed"], ["request_info", "RFI"], ["escalate_sar", "Escalation"]]) {
      const doc = withDisposition(sectionsToDoc(sections), value, "Ask for the Northstar contract and invoices.");
      expect(docSections(doc).find((s) => s.key === "disposition")!.text).toBe(`Decision: ${word}\n\nAnalyst comments: Ask for the Northstar contract and invoices.`);
      expect(docSections(doc).find((s) => s.key === "alert_overview")!.text).toContain("Body of alert_overview.");
    }
  });

  it("recognises the earlier '3. Disposition' heading and renames it when section 3 is updated", () => {
    const old: PMDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "1. Alert number and scenarios" }] },
        { type: "paragraph", content: [{ type: "text", text: "Overview." }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "3. Disposition" }] },
        { type: "paragraph", content: [{ type: "text", text: "RFI" }] },
      ],
    };
    expect(docSections(old).map((s) => s.key)).toEqual(["alert_overview", "disposition"]);
    const next = withDisposition(old, "request_info", "Need the contract.");
    expect(docSections(next).map((s) => s.heading)).toEqual(["1. Alert number and scenarios", "3. Case decision"]);
    expect(docSections(next)[1].text).toBe("Decision: RFI\n\nAnalyst comments: Need the contract.");
  });

  it("splits a list Gemini wrote inline into a lead-in paragraph and bullets", () => {
    const body = "The top counterparties are listed below. - Northstar Ventures Ltd (XB) – sends funds. - Mohammed Rafi (IN) – receives funds. - Ajay Kulkarni (IN) – receives funds.";
    const nodes = docSections(sectionsToDoc([{ key: "counterparty_summary", body }])).find((s) => s.key === "counterparty_summary")!.nodes;
    expect(nodes.map((n) => n.type)).toEqual(["paragraph", "bulletList"]);
    expect(nodes[1].content).toHaveLength(3);
    // A single dash in a sentence is left alone.
    const one = docSections(sectionsToDoc([{ key: "counterparty_summary", body: "Paid on 4 Aug. - see note." }])).find((s) => s.key === "counterparty_summary")!.nodes;
    expect(one.map((n) => n.type)).toEqual(["paragraph"]);
    // Stored drafts are tidied for display the same way.
    const stored: PMDoc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] };
    expect(tidyInlineLists(stored).content.map((n) => n.type)).toEqual(["paragraph", "bulletList"]);
  });

  it("older 8-section narratives still split into their sections and are not given a section 3", () => {
    const legacy: PMDoc = {
      type: "doc",
      content: ["1. Alert overview", "4. Counterparty analysis", "8. Points for analyst decision"].flatMap((h) => [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: h }] },
        { type: "paragraph", content: [{ type: "text", text: `Text of ${h}` }] },
      ]),
    };
    expect(docSections(legacy).map((s) => s.heading)).toEqual(["1. Alert overview", "4. Counterparty analysis", "8. Points for analyst decision"]);
    expect(withDisposition(legacy, "close_nfa")).toEqual(legacy);
  });

  it("turns '- ' lines into a bullet list", () => {
    const doc = sectionsToDoc([{ key: "counterparty_summary", body: "- industry code\n- invoices for Aurelia" }]);
    expect(doc.content.some((n) => n.type === "bulletList")).toBe(true);
  });

  it("regenerating a section replaces only that section", () => {
    const doc = sectionsToDoc(sections);
    const next = replaceSection(doc, "alert_overview", "New overview text.");
    const before = docSections(doc);
    const after = docSections(next);
    expect(after.find((s) => s.key === "alert_overview")!.text).toBe("New overview text.");
    for (const k of SECTION_KEYS.filter((k) => k !== "alert_overview")) {
      expect(after.find((s) => s.key === k)!.text).toBe(before.find((s) => s.key === k)!.text);
    }
    expect(headingText("counterparty_summary")).toBe("2. Transactions with the six counterparties");
  });
});

describe("diff and % AI text kept", () => {
  it("counts word insertions and deletions per section", () => {
    const ai = sectionsToDoc([{ key: "counterparty_summary", body: "Activity is consistent with seasonal trade." }]);
    const edited = sectionsToDoc([{ key: "counterparty_summary", body: "Activity is not consistent with seasonal trade per the RFI." }]);
    const d = diffDocs(ai, edited);
    expect(d.added).toBe(5); // not, trade, per, the, RFI.
    expect(d.removed).toBe(1); // "trade." became "trade"
    const act = d.sections.find((s) => s.heading.startsWith("2."))!;
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
  it("narrative output must contain each AI-drafted section exactly once, and never the disposition", () => {
    const ok = { sections: AI_SECTION_KEYS.map((key) => ({ key, heading: key, body: "x" })) };
    expect(NarrativeOutput.safeParse(ok).success).toBe(true);
    expect(NarrativeOutput.safeParse({ sections: ok.sections.slice(1) }).success).toBe(false);
    expect(NarrativeOutput.safeParse({ sections: [...ok.sections, ok.sections[0]] }).success).toBe(false);
    expect(NarrativeOutput.safeParse({ sections: [...ok.sections, { key: "disposition", heading: "d", body: "Closed" }] }).success).toBe(false);
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

  it("keeps extraction schemas small: no default integer bounds, nullable types instead of anyOf", async () => {
    const { toResponseSchema } = await import("@/lib/llm/gemini");
    const { KycExtraction } = await import("@/lib/llm/schemas");
    const json = JSON.stringify(toResponseSchema(KycExtraction));
    expect(json).not.toContain("9007199254740991");
    expect(json).toContain('"page":{"type":["integer","null"]}');
    expect(json.length).toBeLessThan(8000); // was 10.2 KB before the bounds and anyOf were removed
  });

  it("explains why a Gemini call failed", async () => {
    const { geminiErrorMessage } = await import("@/lib/llm/gemini");
    expect(geminiErrorMessage(503, "m", new Error("x"))).toMatch(/overloaded or unavailable \(503\)/);
    expect(geminiErrorMessage(400, "m", new Error("schema too complex"))).toBe("Gemini rejected the request (400): schema too complex");
    expect(geminiErrorMessage(undefined, "m", new Error("Request timed out"))).toMatch(/took longer than 60 s/);
    expect(geminiErrorMessage(403, "m", new Error(""))).toMatch(/refused the API key \(403\)/);
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

  it("the mock counterparty section gives only relationship and purpose", () => {
    const out = mockNarrative({
      alert: { alert_number: "ALR-2026-000506", alert_date: "2026-06-03" },
      sub_alerts: [],
      review_period: { start: "2026-05-01", end: "2026-05-31", in_period_txn_count: 12, total_flow: 166675, currency: "USD", excluded_txn_count: 3 },
      client_kyc: {},
      counterparties_top6: [{ name: "Westbridge University", total_amount: 29200, pct_of_client_flow: 17.5, direction: "receives funds from the client", flags: ["WS-04"] }],
      relationship_summaries: [{ counterparty: "Westbridge University", relationship_type: "education", summary: "Tuition fees for the client's son.", review_status: "agree" }],
      scenario_findings: [],
    });
    const body = out.sections.find((s) => s.key === "counterparty_summary")!.body;
    expect(body).toContain("- Westbridge University – education; Tuition fees for the client's son.");
    expect(body).not.toMatch(/USD|29,200|WS-04|agreed/);
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

describe("narrative body formatting", () => {
  it("turns a lead-in line followed by bullets into a paragraph and a list", () => {
    const doc = sectionsToDoc([{ key: "counterparty_summary", body: "For escalation:\n- Volume 70× expected\n- High-risk country\n\nAgainst escalation:\n- Long-standing client" }]);
    const nodes = docSections(doc).find((s) => s.key === "counterparty_summary")!.nodes;
    expect(nodes.map((n) => n.type)).toEqual(["paragraph", "bulletList", "paragraph", "bulletList"]);
    expect(docToText(doc)).toMatch(/For escalation:\n+- Volume 70× expected\n- High-risk country/);
  });

  it("uses prompt version 4 (two AI sections; counterparties by relationship and purpose only)", async () => {
    const { loadPrompt } = await import("@/lib/llm/prompts");
    const p = loadPrompt("drafter-system");
    expect(p.version).toBe("drafter-system@4");
    expect(p.text).toContain("Do not mention amounts, transaction counts, dates, scenarios, red flags or review");
    expect(p.text).toContain("never write a disposition");
    expect(p.text).toContain("for each entry in counterparties_top6");
  });
});
