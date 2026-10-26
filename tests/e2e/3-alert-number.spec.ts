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

  // Upload a transaction list, then remove it: its transactions go with it.
  await page.setInputFiles('input[aria-label="Upload documents"]', "seed/files/ALR-2026-000101/transactions_Q3.xlsx");
  await expect(page.getByText("transactions_Q3.xlsx")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Parsing…")).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByText("0 txns")).toHaveCount(1); // no review period yet: all rows in period, none excluded
  await page.getByRole("button", { name: "Remove transactions_Q3.xlsx" }).click();
  await page.getByRole("button", { name: "Remove document" }).click();
  await expect(page.getByText("transactions_Q3.xlsx")).toHaveCount(0);
  await expect(page.getByText("0 txns")).toHaveCount(2);

  // The narrative screen says exactly what is still missing.
  await page.goto(page.url().replace(/\/intake$/, "/narrative"));
  await expect(page.getByText("Q1: choose a scenario for sub-alert ALR-2026-000902-01 (or remove it)")).toBeVisible();
  await expect(page.getByRole("link", { name: "Alert & documents" }).last()).toBeVisible();
  await page.getByRole("button", { name: "Remove 1 empty sub-alert" }).click();
  await expect(page.getByText("Q1: add at least one sub-alert")).toBeVisible();

  await page.goto(page.url().replace(/\/narrative$/, "/audit"));
  await expect(page.getByText(/removed transactions_Q3\.xlsx \(\d+ transactions\)/)).toBeVisible();
  await expect(page.getByText("changed the alert number: ALR-2026-000901 → ALR-2026-000902")).toBeVisible();
});
