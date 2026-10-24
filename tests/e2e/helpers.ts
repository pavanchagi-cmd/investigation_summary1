import { expect, type Page } from "@playwright/test";

export const PASSWORD = "e2e-password";

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(cases|dashboard|admin|qa)/);
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
}

/** Creates a case for a demo alert and attaches its synthetic documents; waits until parsing finishes. */
export async function startDemoCase(page: Page, alertNumber: string) {
  await page.goto("/cases/new");
  await page.fill("#alert-number", alertNumber);
  await page.getByRole("button", { name: "Load alert" }).click();
  await page.waitForURL(/\/intake$/);
  // Re-opening an existing case: documents may already be attached.
  const attach = page.getByRole("button", { name: /Attach demo documents/ });
  if (await attach.isVisible()) await attach.click();
  await expect(page.getByText("transactions_Q3.xlsx")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Parsing…")).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByText("Detecting type…")).toHaveCount(0);
  return page.url().replace(/\/intake$/, "");
}
