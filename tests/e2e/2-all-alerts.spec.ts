import { expect, test } from "@playwright/test";
import { login, startDemoCase } from "./helpers";

// Acceptance: every seed alert runs end to end with no manual DB edits.
for (const [alert, scenario, matches] of [
  ["ALR-2026-000101", "Large Amount Transaction", "2 matches"],
  ["ALR-2026-000102", "Pattern of Funds", "12 matches"],
  ["ALR-2026-000103", "Round Dollar Transaction", "53 matches"],
] as const) {
  test(`${alert} runs end to end`, async ({ page }) => {
    // analyst2 also owns ALR-2026-000101 from the threshold test in 1-workflow.spec.ts.
    await login(page, "analyst2@demo.local");
    const url = await startDemoCase(page, alert);
    await page.getByRole("button", { name: "Exclude with reason" }).click();
    await page.fill("#exclude-reason", "Malformed test rows");
    await page.getByRole("button", { name: /Exclude 2 issues/ }).click();
    await expect(page.getByText(/2 excluded/)).toBeVisible();

    await page.goto(`${url}/purpose`);
    await expect(page.locator("div.rounded-lg", { hasText: scenario }).first()).toContainText(matches);
    await expect(page.getByText("No match")).toHaveCount(3);
    await page.getByRole("button", { name: /Draft summaries with Gemini/ }).click();
    await expect(page.getByText("0 of 6 reviewed")).toBeVisible();
    await page.getByRole("button", { name: /Show 3 more summaries/ }).click();
    for (let i = 0; i < 6; i++) {
      await page.getByRole("radio", { name: i === 5 ? "Needs RFI" : "Agree" }).nth(i).click();
      await expect(page.getByText(new RegExp(`${i + 1} of 6 reviewed`))).toBeVisible();
    }
    await page.getByRole("button", { name: "Generate narrative" }).click();
    await page.waitForURL(/\/narrative$/);
    await expect(page.locator(".ProseMirror")).toContainText("8. Points for analyst decision");
    await page.getByLabel("Close – no further action").check();
    await page.fill("#rationale", "Activity explained by documented trade; no further action required.");
    await page.locator("#rationale").blur();
    await page.getByRole("button", { name: "Approve narrative" }).click();
    await expect(page.getByText("Approved and locked")).toBeVisible();
  });
}
