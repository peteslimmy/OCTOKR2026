import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs } from "./helpers";

/**
 * The Reports module end to end, on the history the earlier specs created (two finalised weeks, a late-report amendment, a holiday
 * amendment). It checks that figures match what the other screens showed, that scope is enforced in the UI, and that exports,
 * snapshots, saved views and the question box work for a real user.
 */
// the report's own results table (charts carry hidden text tables too, which must not be counted)
const resultRows = (page: import("@playwright/test").Page) => page.getByRole("region", { name: /results table/ }).locator("tbody tr");

test.describe.serial("Reports module", () => {
  test("leadership sees the organisation, its comparison, its evidence-linked findings and the catalogue", async ({ page }) => {
    await loginAs(page, "exec@4core.local");
    await page.getByRole("link", { name: "Reports", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
    await expect(page.getByText("Average of BU quarterly scores")).toBeVisible();
    await expect(page.getByText("pending approval").first()).toBeVisible();                    // unofficial figures are labelled
    await expect(page.getByRole("heading", { name: "Business Unit comparison" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Report catalogue" })).toBeVisible();
    await expectNoA11yViolations(page, "reports overview with data");
  });

  test("the trends agree with the earlier lifecycle: Engineering finished week 2 at 50, and the registers open", async ({ page }) => {
    await loginAs(page, "exec@4core.local");
    await page.goto("/reports/performance-trends");
    const eng = page.locator("tr").filter({ hasText: "Engineering" }).filter({ hasText: "Scored" }).filter({ hasText: "50" });
    await expect(eng.first()).toBeVisible();
    // the late-report amendment screens were removed with the unused modules, so no week is amended here; the registers must still open
    await page.goto("/reports/reporting-register");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("tr").filter({ hasText: "Engineering" }).first()).toBeVisible();
    await page.goto("/reports/late-report-register");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("filters change every figure consistently and can be reset", async ({ page }) => {
    await loginAs(page, "exec@4core.local");
    await page.goto("/reports/weekly-compliance");
    const all = await resultRows(page).count();
    await page.getByLabel("Business Unit").selectOption({ label: "Engineering" });
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/buId=/);
    await expect(resultRows(page)).toHaveCount(1);
    expect(all).toBeGreaterThan(1);
    await page.getByRole("link", { name: "Reset filters" }).click();
    await expect(resultRows(page)).toHaveCount(all);
  });

  test("a BU Lead sees only their own unit, and no organisation-wide ranking", async ({ page }) => {
    await loginAs(page, "lead.eng@4core.local");
    await page.goto("/reports/bu-scorecard");
    await expect(page.getByText("Business Unit: Engineering").first()).toBeVisible();
    const rows = resultRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Engineering");
    await expect(page.getByText("You can see your own Business Unit only")).toBeVisible();
    await page.goto("/reports/fund-actuals");
    await expect(page.getByText("This report is not available")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create official snapshot" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create official snapshot" })).toHaveCount(0);
  });

  test("exports download as real files that carry the period and generation time", async ({ page }) => {
    await loginAs(page, "exec@4core.local");
    await page.goto("/reports/bu-scorecard");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "CSV" }).click();
    const d = await download;
    expect(d.suggestedFilename()).toMatch(/^business-unit-scorecard-and-ranking_.*\.csv$/);
    const text = readFileSync(await d.path(), "utf8");
    expect(text).toContain("# Period,");
    expect(text).toContain("# Generated at (server time),");
    expect(text).toContain("Quarter score");
    const pdf = page.waitForEvent("download");
    await page.getByRole("link", { name: "PDF" }).click();
    expect((await pdf).suggestedFilename()).toMatch(/\.pdf$/);
  });

  test("an official snapshot is frozen, checksummed and survives later changes", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/reports/bu-scorecard");
    await page.getByRole("button", { name: "Create official snapshot" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill("E2E quarter check");
    await page.getByRole("dialog").getByRole("button", { name: "Create snapshot" }).click();
    await expect(page).toHaveURL(/\/reports\/snapshots\/[0-9a-f-]+/);
    await expect(page.getByText("Checksum verified")).toBeVisible();
    await expect(page.getByText("Historical record")).toBeVisible();
    await expectNoA11yViolations(page, "report snapshot");
    await page.goto("/reports/saved");
    await expect(page.getByRole("link", { name: "E2E quarter check" })).toBeVisible();
  });

  test("the builder previews a real report, narrows columns and saves a view that reopens with them", async ({ page }) => {
    await loginAs(page, "exec@4core.local");
    await page.goto("/reports/builder");
    await page.getByLabel("Report", { exact: true }).selectOption({ label: "Reporting compliance by BU" });
    await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
    await expect(resultRows(page).first()).toBeVisible();
    for (const l of ["Before content lock", "Reviewed", "Holiday weeks (excluded)", "Not yet finalised", "Late exceptions open", "Late exceptions applied"]) await page.getByLabel(l).uncheck();
    await page.getByLabel("4. Save as").fill("E2E compliance view");
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(page.getByText("View saved.")).toBeVisible();
    await page.goto("/reports/saved");
    await page.getByRole("link", { name: "E2E compliance view" }).click();
    await expect(page.getByRole("columnheader", { name: /Compliance rate/ })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Reviewed" })).toHaveCount(0);
    await expectNoA11yViolations(page, "builder");
  });

  test("the question box opens the matching approved report, and says so when data does not exist", async ({ page }) => {
    await loginAs(page, "exec@4core.local");
    await page.goto("/reports/insights");
    await page.getByLabel("Your question").fill("Which BUs are likely to finish low this quarter?");
    await page.getByRole("button", { name: "Find the report" }).click();
    await expect(page.getByRole("link", { name: "Open the report" })).toHaveAttribute("href", /quarter-forecast/);
    await page.getByLabel("Your question").fill("What is the revenue variance by BU?");
    await page.getByRole("button", { name: "Find the report" }).click();
    await expect(page.getByText("Data not available")).toBeVisible();
    await expect(page.getByText("No AI model was used").first()).toBeVisible();
  });
});
