import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login, logout, startDemoCase } from "./helpers";

test.describe.configure({ mode: "serial" });

let caseUrl = "";

async function axe(page: import("@playwright/test").Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${name}: ${v.id} – ${v.nodes[0]?.target}`)).toEqual([]);
}

test("analyst completes ALR-2026-000123 from alert entry to Word export", async ({ page }) => {
  await login(page, "analyst@demo.local");
  caseUrl = await startDemoCase(page, "ALR-2026-000123");

  // Screen 1: Q1 sub-alerts and Q2 period come from the alert report, with sources.
  await expect(page.getByText("Sub-alerts (3)")).toBeVisible();
  await expect(page.getByRole("button", { name: /alert_report_ALR-2026-000123\.pdf · p\.2/ }).first()).toBeVisible();
  await expect(page.getByText("312 txns")).toBeVisible();
  await expect(page.getByText("18 txns")).toBeVisible();
  await expect(page.getByText("4,142,880")).toBeVisible();
  // Malformed rows are shown, never dropped.
  await expect(page.getByText(/Row 118: Amount: amount "4\.9OO\.00" contains letters/)).toBeVisible();
  await axe(page, "screen 1");
  await page.getByRole("button", { name: "Exclude with reason" }).click();
  await page.fill("#exclude-reason", "Malformed test rows confirmed with operations");
  await page.getByRole("button", { name: /Exclude 2 issues/ }).click();
  await expect(page.getByText(/2 excluded/)).toBeVisible();

  // Screen 2: KYC with sources, missing value shown as such, masked accounts, exactly 6 counterparties.
  await page.goto(`${caseUrl}/client`);
  await expect(page.locator("#q3-client_name")).toHaveValue("Kestrel Trading Pvt Ltd");
  await expect(page.locator("#q3-industry_code")).toHaveAttribute("placeholder", "Not provided in documents");
  await expect(page.locator("#q3-accounts")).toHaveValue(/^••••4417/);
  const rows = page.locator("table").first().locator("tbody tr");
  await expect(rows).toHaveCount(6);
  await expect(page.getByText("50210004417")).toHaveCount(0);
  await axe(page, "screen 2");
  // Swap #5 for R. Menon with a reason.
  await rows.nth(4).getByRole("button", { name: "Swap" }).click();
  await page.getByRole("option", { name: /R\. Menon/ }).click();
  await page.fill("#swap-reason", "Individual on a corporate account; needs review");
  await page.getByRole("button", { name: "Replace #5" }).click();
  await expect(page.getByText(/Swapped in: Individual on a corporate account/)).toBeVisible();
  await expect(rows).toHaveCount(6);

  // Screen 3: red flags, Q5 summaries and statuses, dismiss a flag.
  await page.goto(`${caseUrl}/purpose`);
  await expect(page.getByText("7 matches")).toBeVisible();
  await expect(page.getByText(/7 wires of USD 9,500–9,950 to Pinewood Textiles within 6 days; total 68,900\./)).toBeVisible();
  await expect(page.getByText("12 matches")).toBeVisible();
  await expect(page.getByText("41 matches")).toBeVisible();
  // Summaries are drafted automatically when the screen opens.
  await expect(page.getByText(/no summary yet/i)).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText("0 of 6 reviewed")).toBeVisible();
  await page.getByRole("button", { name: /Show 3 more summaries/ }).click();
  for (let i = 0; i < 6; i++) {
    await page.getByRole("radio", { name: "Agree" }).nth(i).click();
    await expect(page.getByText(`${i + 1} of 6 reviewed`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Dismiss…" }).last().click();
  await page.locator("textarea[id^=dismiss-]").fill("Large receipts are trade settlements with invoices on file.");
  await page.getByRole("button", { name: "Dismiss finding" }).click();
  await expect(page.getByText(/Dismissed by Aditi Rao/)).toBeVisible();
  await axe(page, "screen 3");

  // Screen 4: generate, edit, decide, approve, export.
  await page.getByRole("button", { name: "Generate narrative" }).click();
  await page.waitForURL(/\/narrative$/);
  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText("1. Alert number and scenarios");
  await expect(editor).toContainText("2. Transactions with the six counterparties");
  await expect(editor).toContainText("3. Case decision");
  await expect(editor).toContainText("Decision: to be made by the analyst");
  await expect(editor).toContainText('dismissed by the analyst: "Large receipts are trade settlements');
  await expect(editor).not.toContainText("50210004417");
  await page.getByRole("button", { name: "Approve narrative" }).isDisabled();
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Reviewed against the alert report.");
  await page.getByRole("tab", { name: /Diff/ }).click();
  await expect(page.getByRole("tab", { name: /Diff \(\+[1-9]\d* \/ −\d+\)/ })).toBeVisible();
  await page.getByRole("tab", { name: "Analyst version" }).click();
  await expect(page.getByRole("button", { name: "Approve narrative" })).toBeDisabled();
  await page.getByLabel("Escalate to SAR/STR review").check();
  // Section 3 follows the analyst's decision and saved comments.
  await expect(editor.locator("h2", { hasText: "3. Case decision" }).locator("xpath=following-sibling::p[1]")).toHaveText("Decision: Escalation");
  await page.fill("#rationale", "Unexplained pass-through via Harbourline and structured wires to Pinewood.");
  await page.getByRole("button", { name: "Save comments" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  await expect(editor.locator("h2", { hasText: "3. Case decision" }).locator("xpath=following-sibling::p[2]")).toHaveText(
    "Analyst comments: Unexplained pass-through via Harbourline and structured wires to Pinewood.",
  );
  await page.locator("#rationale").blur();
  await axe(page, "screen 4");
  await page.getByRole("button", { name: "Approve narrative" }).click();
  await expect(page.getByText("Approved and locked")).toBeVisible();
  await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "false");

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Word" }).click()]);
  expect(download.suggestedFilename()).toBe("investigation-summary-ALR-2026-000123.docx");
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PDF" }).click()]);
  expect(pdf.suggestedFilename()).toBe("investigation-summary-ALR-2026-000123.pdf");
  const txt = await (await page.request.get(`${caseUrl.replace(/^.*\/cases/, "/api/cases")}/export?format=txt`)).text();
  expect(txt).toContain("Reviewed against the alert report.");
  expect(txt).toContain("Escalate to SAR/STR review");
  expect(txt).toContain("3. CASE DECISION\n\nDecision: Escalation\n\nAnalyst comments: Unexplained pass-through via Harbourline");
  expect(txt).toContain("reviewed and approved by Aditi Rao");
  await logout(page);
});

test("QA opens the approved case read-only", async ({ page }) => {
  await login(page, "qa@demo.local");
  await page.goto("/qa");
  await page.getByRole("link", { name: "ALR-2026-000123" }).click();
  await page.waitForURL(/\/review$/);
  await expect(page.getByText("QA review · read-only")).toBeVisible();
  await expect(page.locator(".ProseMirror")).toHaveCount(0);
  await expect(page.getByText("Reviewed against the alert report.")).toBeVisible();
  await page.getByRole("tab", { name: /Original AI draft v1/ }).click();
  await expect(page.getByText("Reviewed against the alert report.")).toHaveCount(0);
  await page.getByRole("tab", { name: "Audit log" }).click();
  await expect(page.getByText(/approved the narrative/)).toBeVisible();
  // QA cannot edit through the API either.
  const res = await page.request.patch(`${caseUrl.replace(/^.*\/cases/, "/api/cases")}`, { data: { action: "add_sub_alert" } });
  expect(res.status()).toBe(403);
  await axe(page, "QA review");
  await logout(page);
});

test("admin changes a threshold and the finding count changes", async ({ page }) => {
  await login(page, "analyst2@demo.local");
  const url = await startDemoCase(page, "ALR-2026-000101");
  await page.goto(`${url}/purpose`);
  const card = page.locator("div.rounded-lg", { hasText: "Large Amount Transaction" }).first();
  await expect(card).toContainText("2 matches");
  await logout(page);

  await login(page, "admin@demo.local");
  await page.goto("/admin");
  await page.fill("#rule-large_vs_avg_multiple", "5");
  await page.getByRole("button", { name: "Save thresholds" }).click();
  await expect(page.getByText(/Saved\. Open cases will re-run the analysis\./)).toBeVisible();
  await logout(page);

  await login(page, "analyst2@demo.local");
  await page.goto(`${url}/purpose`);
  await expect(page.locator("div.rounded-lg", { hasText: "Large Amount Transaction" }).first()).toContainText("1 match");
  await logout(page);

  // Restore the default for later runs.
  await login(page, "admin@demo.local");
  await page.goto("/admin");
  await page.fill("#rule-large_vs_avg_multiple", "3");
  await page.getByRole("button", { name: "Save thresholds" }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible();
});

test("case screens have no horizontal scroll at 390 px", async ({ page }) => {
  await login(page, "analyst@demo.local");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const s of ["intake", "client", "purpose", "narrative"]) {
    await page.goto(`${caseUrl}/${s}`);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, s).toBeLessThanOrEqual(0);
  }
});

test("dashboard shows approved cases and works at 390 px", async ({ page }) => {
  await login(page, "admin@demo.local");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Time-to-draft" })).toBeVisible();
  await expect(page.getByText("Manual baseline")).toBeVisible();
  await expect(page.getByText("Not set")).toBeVisible();
  await expect(page.getByText("ALR-2026-000123")).toBeVisible();
  await axe(page, "dashboard");
  await page.setViewportSize({ width: 390, height: 844 });
  // The charts re-measure after the resize; wait for them to settle.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
});
