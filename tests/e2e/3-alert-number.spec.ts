import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("analyst corrects the alert number; sub-alerts follow and duplicates are refused", async ({ page }) => {
  await login(page, "analyst2@demo.local");
  await page.goto("/cases/new");
  await page.fill("#alert-number", "ALR-2026-000901");
  await page.getByRole("button", { name: "Load alert" }).click();
  await page.waitForURL(/\/intake$/);
  await page.getByRole("button", { name: "Add sub-alert" }).click();
  await expect(page.getByLabel("Sub-alert number")).toHaveValue("ALR-2026-000901-01");

  await page.fill("#q1-alert", "alr-2026-000902");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Alert loaded")).toBeVisible();
  await expect(page.locator("#q1-alert")).toHaveValue("ALR-2026-000902");
  await expect(page.getByLabel("Sub-alert number")).toHaveValue("ALR-2026-000902-01");

  // ALR-2026-000123 belongs to another case (1-workflow.spec.ts).
  await page.fill("#q1-alert", "ALR-2026-000123");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#q1-alert-error")).toContainText("Another case already uses ALR-2026-000123");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#q1-alert")).toHaveValue("ALR-2026-000902");

  await page.goto(page.url().replace(/\/intake$/, "/audit"));
  await expect(page.getByText("changed the alert number: ALR-2026-000901 → ALR-2026-000902")).toBeVisible();
});
