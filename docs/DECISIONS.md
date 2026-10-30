# Decisions and open questions

Each entry: what was decided, why, and whether the owner still needs to confirm it.
"Owner-confirmed" means agreed in the build conversation on 24 Oct 2026.

## Stack and environment

| # | Decision | Reason | Status |
|---|---|---|---|
| D1 | Next.js **15.5** (not 16) | Spec section 3; owner said "whichever is convenient" | Owner-confirmed |
| D2 | npm as package manager | Spec commands use npm | Owner-confirmed |
| D3 | SheetJS installed from the npm package `@e965/xlsx` (a republish of the official SheetJS 0.20.3 build) | The official tarball host `cdn.sheetjs.com` is blocked by the build sandbox's network policy, and the old `xlsx@0.18.5` on npm has known vulnerabilities. In the bank's environment switch to `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (same API, import path `xlsx`). | Open – please confirm |
| D4 | Migrations **and** an idempotent seed run inside `vercel-build`, before `next build` | No manual DB steps for the owner; the seed only inserts what is missing | Owner-confirmed |
| D5 | `GEMINI_MODEL` env var, default `gemini-3.5-flash`; Admin page has a "Check Gemini connection" button; no silent fallback model | Model name could not be verified from the build sandbox | Owner-confirmed |
| D6 | Without `DATABASE_URL` the app uses an embedded PGlite database in `.data/` (local dev, CI, e2e only). Without `BLOB_READ_WRITE_TOKEN` uploads go to `.data/uploads` through an authenticated route. Both fallbacks refuse to run on Vercel (`VERCEL=1`). | Lets tests and local dev run without cloud services | Decided |
| D7 | `GEMINI_MOCK=1` switches the LLM wrapper to fixtures (unit tests, e2e, CI). The fixtures are hand-built from the seed generator's ground truth, not recorded from live calls, because no key was available while building. Replace with recorded responses once the key is live (`RUN_LIVE_LLM=1` smoke test). | Spec section 14 asks for recorded fixtures | Open – record once key is available |
| D8 | shadcn/ui-style components are written in the repo (cva + Tailwind + Radix Dialog/Tabs) instead of running the shadcn CLI | Same result, fewer generated files; matches design tokens | Decided |
| D9 | Fonts are self-hosted (IBM Plex woff2 from `@fontsource`, OFL licence in `app/fonts/OFL.txt`) via `next/font/local` | Strict CSP (no Google Fonts host) and offline builds | Decided |

## Design vs spec

| # | Difference | Decision | Status |
|---|---|---|---|
| S1 | Design board 3 ("Purpose & red flags") is empty; Q5 cards and the red-flags panel are drawn at the top of board 2 | Screen 2 = Q3 + Q4 + swap drawer; screen 3 = Q5 cards (left) + red flags + Generate narrative (right) | Owner-confirmed |
| S2 | Design narrative has 7 sections ending with "Points for analyst decision" holding a placeholder; Prompt B has 8 keys incl. `information_gaps` and an AI-written `analyst_considerations` | Spec's 8 keys; display headings follow the design's wording where one exists (e.g. "Activity in the review period", "Red flags identified", "Points for analyst decision") | Owner-confirmed (default 8) |
| S3 | Design shows relationship "Supplier · logistics" | Six fixed relationship types plus an optional free-text sub-type | Owner-confirmed (default 9) |
| S4 | Design ranks "Kestrel Trading (own a/c)" as counterparty #9 | Client's own accounts are excluded from ranking; shown separately as "own-account transfers" (count and value) | Owner-confirmed (default 10) |
| S5 | Design rule RD-02 text says "≥ 40% of outgoing **value**"; spec seed expectation says count | Alert triggers on **count** %; value % is reported alongside | Owner-confirmed (default 11) |
| S6 | Design rule WS-04 text says "5+ wires"; spec default `min_count = 3` | `min_count = 3`, editable on Admin | Owner-confirmed (default 12) |
| S7 | Design shows Pinewood Textiles as "Sending" but the red flag says the 7 wires went **to** Pinewood | Direction is from the counterparty's point of view: Sending = sends funds to the client, Receiving = receives funds from the client. Seed data makes Pinewood "Receiving" so the table and the red flag agree | Decided |
| S8 | Design dismissed Large Amount card says "1 txn of USD 310,000 (3.4× average)". With the design's own counterparty totals (e.g. Harbourline USD 1.284m over 14 txns) many transactions are ≥ USD 50,000, so the rule matches more than one | Seed keeps the design's counterparty totals; the Large Amount finding for ALR-2026-000123 reports whatever the rule finds (asserted exactly in tests) | Decided |
| S9 | Design Morrow Metals is a "Customer" but receives funds from the client | Seed fixtures describe Morrow as a supplier, consistent with the money flow | Decided |
| S10 | Dashboard in the design shows 48 cases over 8 weeks | Seed adds ~40 approved historical cases, flagged `synthetic_history`, for the dashboard; analysts "A. Rao" and "S. Iyer" | Owner-confirmed (default 17) |

## Interpretations of the spec (please confirm)

| # | Spec text | Interpretation | Status |
|---|---|---|---|
| I1 | Pattern of Funds (b) "≥ 5 distinct counterparties funnelling into, or fanning out from, the account within 7 days" | Implemented literally (any rolling 7-day window with ≥ `funnel_min_counterparties` distinct senders, or receivers). Parameters are in config. For a busy trading account this fires often; the seed data is built so it fires only where planted | Open – please confirm |
| I2 | Pattern of Funds (c) "funds sent to a counterparty that later return from the same or a linked party" – no window or amount rule given | Return must be within `circular_days` (default 30) and within `passthrough_tolerance` of the amount sent. "Linked" = same normalised name or same account number | Open – please confirm |
| I3 | Pattern of Funds (a) "outgoing debits whose sum is within tolerance" | Deterministic: first a single debit within tolerance, else the date-ordered run of debits in the window whose running total first lands within tolerance. Each debit is used once | Open – please confirm |
| I4 | Pattern of Funds (d) "prior 6-month average **or** KYC expected monthly value" | Both bases are evaluated when available; the finding fires if either ratio ≥ `volume_change_multiple`. Volume change contributes metrics, not matched transactions | Open – please confirm |
| I5 | Large Amount "history outside the period if available" | Average of out-of-period transactions if there is at least one; otherwise the in-period median | Decided |
| I6 | Round Dollar `round_pct_alert` | Applied per direction; matched transactions = the round ones in the direction(s) that reach the threshold | Decided |
| I7 | Wire Structuring (a) | Near-band wires in either direction; (b) split payments are outgoing only (to the same beneficiary) | Decided |
| I8 | "Coalesce autosaves within one minute into the same version" vs "never update narratives rows" | Rows are never updated. The client autosaves after 5 s idle but at most once per 60 s, so a minute of typing becomes one version | Decided |
| I9 | Open parse issues "resolved or explicitly accepted" | Each issue must be Fixed or Excluded with a reason; "Exclude all remaining with reason" is the explicit acceptance (logged) | Decided |
| I10 | `ai_value` written once | Re-parsing or changing a document type never overwrites an existing `ai_value`; new fields are added | Decided |
| I11 | Unknown transaction type text (not in the synonym map) | Raised as a parse issue (Fix / Exclude), never guessed | Decided |
| I12 | "Signed, short-lived download URLs" for private blobs | Files are streamed through an authenticated route (`/api/documents/[id]/file`) that checks case access; no blob URL reaches the browser | Decided |
| I13 | Demo document sets | The four seed document sets ship in `/seed`. Screen 1 has "Attach demo documents" for the four demo alert numbers, which uploads them through the normal pipeline | Decided |
| I15 | "Generate narrative disabled until Q1–Q4 are complete" – which Q3 fields are required | Client name, client ID / CIF, entity type and nature of business must have a value; other Q3 fields may stay "Not provided in documents" and are listed under information gaps | Open – please confirm |
| I16 | Transactions read by Gemini from PDF/image tables | Validated by the same normaliser; their raw rows are stored so Fix / mapping changes re-validate without a new Gemini call | Decided |
| I17 | "Within N days" | Pass-through: payment date minus receipt date ≤ `passthrough_days` (same day counts). Rolling windows (funnel, structuring): first to last date spans at most `window_days` calendar days | Decided |
| I18 | Seed counterparties | The design shows 23 ranked counterparties; the seed has 19 (plus the client's own account, excluded). Fewer minor parties keep the funnel rule from firing by accident (see I1). Top-6 figures, total flow, 312 / 18 transactions and the red-flag texts match the design | Decided |
| I19 | Ranking order for ALR-2026-000123 | The spec's weighted score ranks Aurelia (high-risk + weak-regulation + "holdings") first and Orbis (MSB) above R. Menon, so the top 6 differs from the design's amount-ordered table; R. Menon can be swapped in | Decided |
| I20 | Round Dollar value % for ALR-2026-000123 | Design text says 58% of outgoing value; the seed gives 78% (count 41 of 96 = 43% matches) | Decided |
| I21 | Seed PDFs are built with pdfkit (dev dependency) instead of @react-pdf | @react-pdf cannot be loaded by the tsx script runner; the app's PDF export still uses @react-pdf/renderer as specified | Decided |
| I22 | Q5 generation | One Gemini call drafts summaries for every top-6 counterparty without one (after a swap only the new one is drafted). Re-drafting never overwrites analyst text silently | Decided |
| I23 | Final version on approval | Approval always stores an analyst-kind final version (a copy of v1 if the AI draft was accepted unchanged) | Decided |
| I24 | Dashboard visibility | Metrics are team-wide (approved cases only, filterable by analyst); the recent-cases table shows an analyst only their own cases | Decided |
| I25 | Dashboard KPI "average time-to-draft" | Uses active time (as the spec's KPI list says); wall-clock is shown underneath. The weekly chart also uses active minutes | Decided |
| I26 | Admin role changes | Take effect at the user's next sign-in (JWT sessions) | Decided |
| I27 | Export roles | Spec lists analyst and QA; admin can export too (read-only role, all cases) | Decided |
| I30 | Narrative sections (owner request; replaces the spec's 8 sections, S2) | Three sections: 1. Alert number and scenarios, 2. Transactions with the six counterparties (purpose from the Q5 summaries with the analyst's Agree / Edited / Needs RFI status, and linked red flags), 3. Disposition. Gemini drafts 1–2 only (Prompt B v3); section 3 shows the analyst's own choice in one word (Closed / RFI / Escalation), follows the Disposition panel in the editor and is enforced on approval. Narratives drafted earlier keep their 8 sections | Decided |
| I29 | Narrative style (owner request, superseded by I30) | Prompt B v2: plain English, short sentences, about 350–450 words; client profile states what the account is for; counterparty analysis is one bullet per top-6 counterparty (relationship, purpose, amounts, KYC fit) and names no others. Section keys and headings unchanged | Decided |
| I28 | Amount auto-correction (owner request) | Unambiguous amount typos (letter O/o → 0, I/l → 1, doubled decimal point, a stray ".00" after a two-place decimal) are corrected on parse and stored as fixed parse issues with the original value, labelled "auto-corrected – analyst to verify", audit-logged, and changeable through Fix rows. Anything ambiguous (e.g. "4.9OO.00") stays an open issue | Decided |
| I14 | Extra columns beyond the spec's table list | `cases.active_seconds`, `cases.last_heartbeat_at`, `cases.needs_analysis`, `documents.extraction`, `documents.column_mapping`, `parse_issues.raw_row`, `parse_issues.fixed_values`, `parse_issues.field`, `documents.parse_error`, `documents.confidence`, `documents.currency`, `case_fields.confidence`, `counterparties.stale`, `relationship_summaries.relationship_subtype/sources`, `scenario_findings.subtype/params`, `counterparties.swapped_for`, `cases.analysis_meta`, `cases.pct_ai_kept`, `transactions.id_generated`, `counterparties.key/raw_names/reason`, `sub_alerts.ai_value`, `users.permissions`, `cases.synthetic_history` | Decided |
