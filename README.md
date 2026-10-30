# TM Investigation Summary Drafter

Cuts the time a Level 2 AML transaction-monitoring analyst spends writing an investigation summary, and measures it.
The analyst enters an alert number and uploads the alert's documents; the app parses them, pre-fills five questions
(each value with its source), runs deterministic red-flag rules and counterparty ranking, and drafts a case narrative
with Google Gemini for the analyst to edit, decide on and approve. Word, PDF and plain-text exports; full audit trail;
a time-to-draft dashboard.

**The AI drafts; the analyst decides.** No code path sets a disposition, closes or escalates a case without an explicit
analyst action. Every AI value is labelled "AI draft – analyst to verify", carries a source, and is stored next to the
analyst's edit.

Production URL: https://investigationsummary1.vercel.app

## Screens

1. **Alert & documents** – Q1 alert number and sub-alerts, Q2 review period, document uploads with type detection,
   parse issues (Fix / Exclude with reason).
2. **Client & counterparties** – Q3 KYC fields with sources and risk tiles, Q4 top-6 counterparties with swap drawer.
3. **Purpose & red flags** – Q5 relationship summaries (Agree / Edited / Needs RFI), red-flag cards with dismiss, Generate narrative.
4. **Narrative & decision** – three-section narrative (alert and scenarios; transactions with the six counterparties; the analyst's disposition), TipTap editor, original AI draft, word diff, regenerate section, disposition, approve, export, audit trail.
5. **Dashboard** – cases drafted, average time-to-draft, manual baseline, % of AI text kept, weekly trend, dispositions.

Plus **QA review** (read-only: final narrative, AI draft, diff, edit history, audit log) and **Admin settings**
(thresholds, weights, country/institution lists, FX rates, baseline, retention, user roles, Gemini connection check).

## Stack

Next.js 15 (App Router, TypeScript strict) · Tailwind CSS v4 + shadcn-style components · TipTap · Postgres (Neon) with
Drizzle · Vercel Blob (private) · Auth.js v5 (credentials, roles analyst / qa / admin) · Google Gemini via `@google/genai`
(server only) · SheetJS, Papa Parse, mammoth · Zod · jsdiff · `docx`, `@react-pdf/renderer` · Recharts · Vitest, Playwright.

Design and spec differences, interpretations and open questions are listed in [`docs/DECISIONS.md`](docs/DECISIONS.md);
the milestone checklist is in [`docs/PLAN.md`](docs/PLAN.md).

## Local setup

```bash
npm i
cp .env.example .env.local        # or: npx vercel env pull .env.local
# set at least AUTH_SECRET and SEED_USER_PASSWORD in .env.local
npm run db:migrate
npm run db:seed
npm run dev                        # http://localhost:3000
```

Without `DATABASE_URL` the app uses an embedded PGlite database in `.data/pglite`; without `BLOB_READ_WRITE_TOKEN`
uploads are stored in `.data/uploads`. Both fallbacks are refused on Vercel. Set `GEMINI_MOCK=1` to run without a
Gemini key (deterministic fixtures built from the seed data). Stop `npm run dev` before running `db:migrate` / `db:seed`
against PGlite – it allows one process at a time.

### Demo logins

| Email | Role |
|---|---|
| `analyst@demo.local` | Analyst (Aditi Rao) |
| `analyst2@demo.local` | Analyst (Sanjay Iyer) |
| `qa@demo.local` | QA reviewer |
| `admin@demo.local` | Admin |

The password is the value of `SEED_USER_PASSWORD`.

### Demo alerts

Four synthetic alerts ship in `seed/files/` (one per scenario). Enter one of these alert numbers on **New investigation
summary**, then click **Attach demo documents** on screen 1:

| Alert | Fictional client | Scenario planted |
|---|---|---|
| ALR-2026-000101 | Northwind Castings Pvt Ltd | Large Amount Transaction |
| ALR-2026-000102 | Larkspur Commodities Pvt Ltd | Pattern of Funds (6 pass-through pairs) |
| ALR-2026-000103 | Marigold Wholesale Pvt Ltd | Round Dollar Transaction |
| ALR-2026-000123 | Kestrel Trading Pvt Ltd (as in the design) | Wire Structuring + Round Dollar + Pattern of Funds |

Each set has an alert report (PDF), transactions (XLSX, with 2 malformed rows – one auto-corrected amount typo in 101–103, otherwise left for the analyst – and 18 rows outside the review period),
KYC profile (PDF), counterparties (CSV), prior case history (DOCX) and an RFI response (JPG scan). Regenerate them with
`npm run seed:generate` (fixed random seeds; needs Playwright Chromium for the JPG). The seed also adds ~40 approved
historical cases flagged `synthetic_history`, so the dashboard has data.

## Environment variables

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (added by the Neon integration) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob store (added when the store is connected) |
| `AUTH_SECRET` | Auth.js session secret (`npx auth secret`) |
| `GEMINI_API_KEY` | Gemini key – server only, never sent to the browser |
| `GEMINI_MODEL` | Model ID, default `gemini-3.5-flash`. Use Admin → "Check Gemini connection" to confirm it exists for your key |
| `GEMINI_NARRATIVE_MODEL` | Optional override for the narrative call |
| `GEMINI_BACKEND` | `developer` (API key) or `agent_platform` (Agent Platform / Vertex AI with `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`) |
| `SEED_USER_PASSWORD` | Password for the demo users |
| `GEMINI_MOCK` | `1` = use fixtures instead of Gemini (tests, CI, demos without a key) |

## Tests

```bash
npm run lint && npm run typecheck && npm test     # unit tests (Vitest), as in CI
npm run build && npm run test:e2e                 # Playwright, fresh embedded DB, Gemini mocked
RUN_LIVE_LLM=1 GEMINI_API_KEY=… npx vitest run tests/unit/live-llm.test.ts   # optional live smoke test
```

Unit tests cover every rule and the ranking against the seed data (parsed from the generated XLSX), header mapping,
date/amount parsing, masking, Zod schemas, diff and % kept. End-to-end tests run all four demo alerts from alert entry
to approval and export, QA read-only access, an admin threshold change that changes a finding count, axe accessibility
scans, and 390 px layouts.

## Deployment (GitHub → Vercel)

1. In Vercel: **Add New → Project → Import** this repository (framework preset Next.js).
2. Project **Storage** tab: connect a **Neon Postgres** database and a **Blob** store (adds `DATABASE_URL` and
   `BLOB_READ_WRITE_TOKEN`).
3. **Settings → Environment Variables** (Production, Preview, Development): `GEMINI_API_KEY`, `GEMINI_MODEL`,
   `GEMINI_BACKEND=developer`, `AUTH_SECRET`, `SEED_USER_PASSWORD`.
4. Deploy. The build command (`vercel.json` → `npm run vercel-build`) runs the Drizzle migrations and the idempotent seed
   before `next build`, so no manual database step is needed.
5. Open the URL, sign in as `analyst@demo.local`, and walk through ALR-2026-000123. Every push to `main` redeploys.

Long-running routes (document parsing, narrative) set `maxDuration` up to 300 s; parsing runs after the upload response
and the UI polls for status.

## Data handling

- **Synthetic data only in this demo.** No real customer data in seeds, tests, fixtures or logs.
- A free Gemini API key may be used **only with synthetic data**. Real data needs a paid key (Google does not use
  paid-tier prompts to improve its products) or, preferably for a bank, `GEMINI_BACKEND=agent_platform` with a fixed region.
- PDFs and images are sent to Gemini inline (no Files API), so nothing is stored at Google beyond the request.
- Prompts and responses are never written to the console or Vercel logs; only model, prompt version, input hash,
  latency and token counts are audit-logged. Document text is wrapped in delimiters and treated as data.
- Account numbers are masked to the last 4 digits in every screen and export unless a user has `view_full_account`.
- Uploaded files are private; the browser only reaches them through an authenticated route.
- Strict CSP with nonces, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- Retention: Admin → retention period and "Purge demo data now" (or `npm run db:purge`). Virus scanning is out of scope
  for the demo; the hook is `scanUpload()` in `lib/storage`.

## Project structure

```
app/(auth)/login              sign in
app/(app)/cases               case list, new case, and per case: intake, client, purpose, narrative, review, audit
app/(app)/dashboard           screen 5
app/(app)/qa, admin           QA list, admin settings
app/api/...                   route handlers (Zod-validated, role-checked, audit-logged)
components/                   UI (shell, case, intake, client, purpose, narrative, review, dashboard, admin)
lib/db                        Drizzle schema and client (Postgres / PGlite)
lib/parsing                   file readers, header mapping, normaliser, Gemini extraction, pre-fill
lib/rules, lib/ranking        scenario detection and counterparty ranking (pure functions)
lib/llm                       Gemini wrapper, schemas, prompts loader, mock fixtures
lib/narrative, lib/export     narrative versions/diff, Word/PDF/text builders
lib/audit                     audit logger and descriptions
prompts/                      drafter-system.md (Prompt B) and extraction/Q5 prompts, versioned in front matter
seed/                         synthetic document sets and extraction fixtures
scripts/                      migrate, seed, seed generator, purge
tests/unit, tests/e2e         Vitest and Playwright
docs/                         PLAN.md, DECISIONS.md
```
