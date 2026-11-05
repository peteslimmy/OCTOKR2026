import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs } from "./helpers";

/** Metric cards on the HR and Finance dashboards: the real figure is always what a reader gets, the animation is optional, and the definition opens in place. */
const cardOf = (page: import("@playwright/test").Page, label: string) => page.locator("div.rounded-xl").filter({ has: page.getByText(label, { exact: true }) }).first();

test.describe("metric cards", () => {
  test("show the real figure at rest, explain themselves in place and link to the records", async ({ page }) => {
    await loginAs(page, "hr@4core.local");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");   // the page is interactive once its scripts have loaded
    const card = cardOf(page, "Amendments awaiting decision");
    await expect(card).toBeVisible();
    const real = (await card.locator(".sr-only").first().innerText()).trim();
    await expect(card.locator("[aria-hidden]").first()).toHaveText(real, { timeout: 3_000 });       // the count-up has settled on the real figure
    await card.getByText("What does this mean?").click();
    await expect(card.getByText(/Attendance corrections that someone has asked for/)).toBeVisible();
    await expect(card.getByRole("link", { name: /Review queue/ })).toHaveAttribute("href", "/governance/amendments");
    await expectNoA11yViolations(page, "dashboard metric cards");
  });

  test("with reduced motion the figure is final immediately", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loginAs(page, "finance@4core.local");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");   // the page is interactive once its scripts have loaded
    const card = cardOf(page, "Waiting for your decision");
    await expect(card).toBeVisible();
    const real = (await card.locator(".sr-only").first().innerText()).trim();
    expect((await card.locator("[aria-hidden]").first().innerText()).trim()).toBe(real);
  });

  test("the definition control is reachable and operable from the keyboard", async ({ page }) => {
    await loginAs(page, "finance@4core.local");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");   // the page is interactive once its scripts have loaded
    const card = cardOf(page, "Waiting for your decision");
    const summary = card.getByText("What does this mean?");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(card.getByText(/Disbursement requests that have been submitted/)).toBeVisible();
  });

  test("the executive overview leads with four figures that link to the reports behind them", async ({ page }) => {
    await loginAs(page, "exec@4core.local");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");   // the page is interactive once its scripts have loaded
    for (const [label, href] of [["Average BU quarter score", "/reports/performance-trends"], ["BUs with missing reports", "/reports/reporting-register"],
      ["Non-compliant weeks recorded", "/reports/weekly-compliance"], ["Integrity corrections", "/reports/integrity-corrections"]]) {
      const card = cardOf(page, label);
      await expect(card).toBeVisible();
      await expect(card.getByRole("link").first()).toHaveAttribute("href", href);
    }
    await cardOf(page, "Average BU quarter score").getByText("What does this mean?").click();
    await expect(page.getByText(/does not weight units by size/)).toBeVisible();
    await expect(cardOf(page, "Average BU quarter score").locator(".sr-only").filter({ hasText: /^\d+\.\d%$/ }).first()).toHaveText(/^\d+\.\d%$/);   // one decimal place
    await expectNoA11yViolations(page, "executive dashboard");
  });

  test("a BU Lead sees their own quarter at a glance, on a phone too", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page, "lead.eng@4core.local");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");   // the page is interactive once its scripts have loaded
    for (const label of ["Quarter execution score", "Weeks with no report", "Reportable weeks"]) await expect(cardOf(page, label)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoA11yViolations(page, "BU dashboard on a phone");
  });
});
