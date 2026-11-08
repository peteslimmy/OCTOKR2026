import { expect, test } from "@playwright/test";
import { activeWeek, at, expectNoA11yViolations, loginAs, setClock } from "./helpers";

/**
 * The accessibility gate (WCAG 2.2 A/AA + best practice): every screen a role can reach must have zero axe violations.
 * The clock is frozen on the second Monday of the active quarter so screens show live data, not empty states.
 */
const ROUTES: Record<string, string[]> = {
  "lead.eng@4core.local": ["/dashboard", "/strategy", "/weekly", "/performance", "/notifications", "/account/security", "/reports", "/reports/bu-scorecard", "/reports/weekly-compliance"],
  "presenter@4core.local": ["/dashboard", "/presentation", "/performance"],
  "hr@4core.local": ["/governance", "/governance/amendments", "/violations?tab=violations", "/violations?tab=settings", "/violations", "/notifications"],
  "finance@4core.local": ["/violations?tab=fund", "/violations?tab=fund&view=ledger", "/dashboard", "/reports/fund-actuals"],
  "exec@4core.local": ["/dashboard", "/insights", "/insights/detail", "/performance", "/reports", "/reports/org-performance-summary", "/reports/bu-scorecard", "/reports/performance-trends", "/reports/quarter-forecast",
    "/reports/weekly-compliance", "/reports/reporting-register", "/reports/late-report-register", "/reports/okr-health", "/reports/governance-outstanding", "/reports/integrity-corrections",
    "/reports/holiday-impact", "/reports/data-quality", "/reports/insights", "/reports/metrics", "/reports/saved", "/reports/builder"],
  "admin@4core.local": ["/dashboard", "/admin", "/admin/units", "/admin/people", "/admin/calendar", "/admin/settings", "/admin/branding", "/audit", "/governance", "/account/security", "/strategy"],
};

test.beforeAll(async () => {
  const w = await activeWeek(1);
  setClock(at(w.start, 10 * 60));
});

// one test per user and route: each axe scan of a data-rich page can take several seconds, and a failure names the page
for (const [email, routes] of Object.entries(ROUTES)) {
  for (const route of routes) {
    test(`accessibility: ${email} ${route}`, async ({ page }) => {
      await loginAs(page, email);
      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
      await expectNoA11yViolations(page, `${route} as ${email}`);
    });
  }
}

test("accessibility: signed-out screens", async ({ page }) => {
  for (const route of ["/login", "/login?mfa=1", "/forgot-password", "/forgot-password?expired=1", "/reset-password"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    await expectNoA11yViolations(page, route);
  }
});

test("accessibility: dialogs", async ({ page }) => {
  await loginAs(page, "lead.eng@4core.local");
  await page.goto("/weekly");
  await page.getByRole("button", { name: "Start report" }).first().click();
  // the first visit to the report editor compiles it on demand in the dev server, which can take longer than the default wait
  await expect(page).toHaveURL(/\/weekly\/[0-9a-f-]+/, { timeout: 90_000 });
  await page.getByRole("button", { name: "Add goal" }).first().click({ timeout: 60_000 });
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30_000 });
  await expectNoA11yViolations(page, "goal dialog");
});

test("small screens: no horizontal scrolling on the main screens", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginAs(page, "lead.eng@4core.local");
  for (const route of ["/dashboard", "/weekly", "/strategy", "/notifications"]) {
    await page.goto(route);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${route} overflows the viewport`).toBeLessThanOrEqual(0);
  }
});
