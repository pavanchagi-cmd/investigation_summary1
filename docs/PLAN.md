# Build plan – TM Investigation Summary Drafter

Source of truth: `TM Investigation Summary Drafter – Technical Build Spec for Claude Code` (functional/technical)
and the five-screen HTML design (visual). Where they disagree the spec wins; differences are in `DECISIONS.md`.

Each milestone ends with lint, typecheck and unit tests passing and a push to `main`.

## Milestone 1 · Foundation
- [x] Scaffold Next.js 15 (App Router, TypeScript strict, Tailwind v4, ESLint)
- [x] Design tokens and IBM Plex fonts (self-hosted)
- [x] App shell (dark top bar, nav, case timer, user + role) and four-step stepper
- [x] Auth.js v5 credentials provider, JWT sessions, roles analyst / qa / admin, `requireRole`
- [x] Drizzle schema for the 13 tables + migrations; Postgres (Neon) in prod, PGlite locally
- [x] Security headers (CSP with nonce, X-Frame-Options, Referrer-Policy)
- [x] CI workflow (install, lint, typecheck, unit tests)
- [x] `vercel-build` runs migrate + seed before `next build`
- [ ] Vercel project imported and first deploy (owner, in the Vercel dashboard – not possible from the build sandbox)

## Milestone 2 · Cases and uploads
- [x] Create case from alert number (configurable regex), timer persisted server-side
- [x] Case list
- [x] Upload token route (Vercel Blob client upload, private); local-disk fallback for dev/tests
- [x] Register document, rule-based type detection (+ Gemini fallback), type correction re-parses
- [x] Documents panel on screen 1

## Milestone 3 · Parsing
- [x] Header synonym mapping + mapping dialog when required columns are missing
- [x] Date / amount / direction / type / currency / country validation, parse issues (fix / exclude)
- [x] Gemini extraction for PDF, DOCX, images (inline data, page references)
- [x] Pre-fill Q1–Q3 with sources; review-period filter and stats

## Milestone 4 · Rules and ranking
- [x] Four scenario rules (pure functions) with config-driven parameters
- [x] Counterparty ranking (pure function), top 6, swap with reason
- [x] Red flags panel with dismiss/restore, Q3 + Q4 screen, swap drawer
- [x] Admin config page (thresholds, weights, lists, baseline, retention, users' roles)

## Milestone 5 · Q5 summaries
- [x] Gemini call 3 for the top 6, cards with Agree / Edited / Needs RFI

## Milestone 6 · Narrative
- [x] Prompt B, Gemini call 4, TipTap editor, versioning, autosave, diff, % kept
- [x] Regenerate section, disposition, approve / unlock

## Milestone 7 · Export, audit, QA view
- [x] Word, PDF, copy text exports
- [x] Full audit log page; QA read-only review page

## Milestone 8 · Dashboard and polish
- [x] Dashboard metrics and charts
- [x] Seed generator + seed data for all four alerts
- [x] Playwright end-to-end tests
- [x] Accessibility pass, README

## Verification log (24 Oct 2026)
- Unit tests: 67 passing (`npm test`), lint and typecheck clean.
- Playwright: 8 passing – all four demo alerts end to end, QA read-only, admin threshold change, 390 px layouts, axe scans.
- Lighthouse accessibility: 100 on all five screens at 1280 px and in mobile emulation (390 px).
- Not yet verified: a production deploy on Vercel and live Gemini calls (no key or Vercel access in the build sandbox).
