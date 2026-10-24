/**
 * Generates the synthetic demo document sets (fixed random seeds, so output is identical every run):
 *   seed/files/<alert>/      alert report (PDF), transactions (XLSX), KYC profile (PDF),
 *                            counterparties (CSV), prior case history (DOCX), RFI response (JPG scan)
 *   seed/fixtures/extraction recorded-style Gemini extraction results for GEMINI_MOCK mode
 * The JPG is rendered with Playwright Chromium (`npx playwright install chromium` if missing).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";
import { buildSeedAlerts } from "../lib/seed/alerts";
import { alertReportPdf, counterpartiesCsv, kycPdf, priorCasesDocx, rfiHtml, transactionsXlsx } from "../lib/seed/files";
import { alertReportFixture, caseHistoryFixture, kycFixture, rfiFixture, seedFileNames } from "../lib/seed/fixtures";

const ROOT = path.join(process.cwd(), "seed");

async function main() {
  // Use a pre-installed Chromium when present (e.g. cloud sandboxes); otherwise Playwright's own.
  const preinstalled = process.env.PW_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
  const browser = await chromium.launch(existsSync(preinstalled) ? { executablePath: preinstalled } : {});
  const page = await browser.newPage({ viewport: { width: 820, height: 900 } });
  const fixturesDir = path.join(ROOT, "fixtures", "extraction");
  await fs.mkdir(fixturesDir, { recursive: true });

  for (const a of buildSeedAlerts()) {
    const dir = path.join(ROOT, "files", a.alertNumber);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const n = seedFileNames(a);
    await fs.writeFile(path.join(dir, n.alertReport), await alertReportPdf(a));
    await fs.writeFile(path.join(dir, n.transactions), transactionsXlsx(a));
    await fs.writeFile(path.join(dir, n.kyc), await kycPdf(a));
    await fs.writeFile(path.join(dir, n.counterparties), counterpartiesCsv(a));
    await fs.writeFile(path.join(dir, n.priorCases), await priorCasesDocx(a));
    await page.setContent(rfiHtml(a));
    await fs.writeFile(path.join(dir, n.rfi), await page.locator(".sheet").screenshot({ type: "jpeg", quality: 70 }));

    const fx = (type: string, file: string, data: unknown) =>
      fs.writeFile(path.join(fixturesDir, `${type}__${file}.json`), JSON.stringify(data, null, 2) + "\n");
    await fx("alert_report", n.alertReport, alertReportFixture(a));
    await fx("kyc_profile", n.kyc, kycFixture(a));
    await fx("case_history", n.priorCases, caseHistoryFixture(a));
    await fx("rfi_response", n.rfi, rfiFixture(a));
    console.log(`${a.alertNumber}: ${a.txns.length} transactions + ${a.malformed.length} malformed rows`);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
