import { expect, test } from "@playwright/test";
import { activeWeek, at, expectNoA11yViolations, loginAs, setClock } from "./helpers";

/**
 * Navigation, create menu, search, step forms and the interactive charts, with motion switched ON (the rest of the suite runs with reduced
 * motion for stability). The 3D scenes need WebGL; where the browser has none the page says so and the 2D chart carries the same figures.
 */
test.use({ reducedMotion: "no-preference" });

test.beforeAll(async () => {
  const w = await activeWeek(1);
  setClock(at(w.start, 10 * 60));
});

test.describe("navigation and quick actions", () => {
  test("the sidebar is grouped and the + Create menu opens the right dialog", async ({ page }) => {
    await loginAs(page, "hr@4core.local");
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "Primary" });
    for (const group of ["Overview", "Execution", "Governance", "Finance", "Insights"]) await expect(nav.getByRole("button", { name: group })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Violations" })).toBeVisible();
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByRole("menuitem", { name: /Report a violation/ }).click();
    await expect(page.getByRole("dialog", { name: "Raise a violation" })).toBeVisible();
  });

  test("Ctrl K finds a page and goes to it", async ({ page }) => {
    await loginAs(page, "hr@4core.local");
    await page.goto("/dashboard");
    await page.keyboard.press("Control+k");
    await page.getByRole("textbox", { name: "Search" }).fill("violat");
    await expect(page.getByRole("option", { name: /Violations/ }).first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/governance\/violations/);
  });

  test("an Admin finds units, people, branding and settings as separate pages", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin");
    for (const name of ["Business Units & Departments", "People", "Calendar & holidays", "Settings", "Branding"]) await expect(page.getByRole("main").getByRole("link", { name: new RegExp(name) }).first()).toBeVisible();
    await page.goto("/admin/units");
    await expect(page.getByRole("heading", { name: "Business Units", exact: false }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Departments \(/ })).toBeVisible();
  });
});

test.describe("step forms", () => {
  test("a violation is raised in steps with a review before anything is sent", async ({ page }) => {
    await loginAs(page, "hr@4core.local");
    await page.goto("/governance/violations?new=violation");
    const dialog = page.getByRole("dialog", { name: "Raise a violation" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Next" })).toBeDisabled();           // nothing chosen yet
    await dialog.getByLabel("Staff member").selectOption({ index: 1 });
    await dialog.getByLabel("Violation type").selectOption({ index: 1 });
    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByLabel("Notes (optional)")).toBeVisible();
    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByRole("list", { name: "Progress" })).toBeVisible();
    await expect(dialog.getByLabel("Violation summary")).toContainText("Staff member");
    await dialog.getByRole("button", { name: "Back" }).click();
    await expect(dialog.getByLabel("Notes (optional)")).toBeVisible();
  });

  test("a disbursement request needs an amount before it can move on", async ({ page }) => {
    await loginAs(page, "hr@4core.local");
    await page.goto("/finance?new=disbursement");
    const dialog = page.getByRole("dialog", { name: "Request a disbursement" });
    await expect(dialog.getByRole("button", { name: "Next" })).toBeDisabled();
    await dialog.getByLabel("Amount (₦)").fill("1500");
    await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.getByLabel("Purpose").fill("Team lunch");
    await dialog.getByLabel("Justification").fill("Quarter close celebration");
    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByLabel("Request summary")).toContainText("Team lunch");
  });
});

test.describe("interactive dashboard", () => {
  test("shows figure cards and charts, filters, sorts, exports and drills down", async ({ page }) => {
    await loginAs(page, "exec@4core.local");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Total tasks", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Units by week" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();

    // the heat map can be read three ways
    await page.getByRole("radio", { name: "Completion" }).click();
    await expect(page.getByRole("table", { name: /Completion for each unit in each week/ })).toBeAttached();
    await page.getByRole("radio", { name: "Score", exact: true }).click();

    // search narrows every panel
    const table = page.getByRole("table", { name: /Business Units and Departments compared/ });
    const before = await table.locator("tbody tr").count();
    expect(before).toBeGreaterThan(0);
    await page.getByRole("textbox", { name: "Search units" }).fill("zzzz-no-such-unit");
    await expect(table.locator("tbody tr")).toHaveCount(0);
    await page.getByRole("textbox", { name: "Search units" }).fill("");
    await expect(table.locator("tbody tr")).toHaveCount(before);

    // the activity chart switches between its views, and the table behind it opens
    await page.getByRole("radio", { name: "Scores", exact: true }).click();
    await page.getByRole("radio", { name: "Reporting" }).click();
    await page.getByRole("button", { name: "Activity options" }).click();
    await page.getByRole("menuitem", { name: "View as table" }).click();
    await expect(page.getByRole("table", { name: "Weekly figures behind the chart" })).toBeVisible();

    // Export downloads a CSV
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^units-.*.csv$/);

    // drill down by selecting a unit
    await table.locator("tbody").getByRole("button").first().click();            // the first button in the table is a column heading that sorts; a unit is in the body
    await expect(page.getByRole("heading", { name: /— week by week/ })).toBeVisible();
    await expectNoA11yViolations(page, "interactive dashboard");
  });

  test("the 3D explorer draws, or says plainly that this browser cannot", async ({ page }) => {
    await loginAs(page, "exec@4core.local");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    const section = page.getByRole("heading", { name: "Explore in 3D" });
    await section.scrollIntoViewIfNeeded();
    const threeD = page.getByRole("img", { name: /3D stacked columns/ });
    const noWebgl = page.getByText("3D view is not available in this browser").first();
    const empty = page.getByText(/Nothing to draw yet|No tasks recorded for this selection yet/).first();
    await expect(threeD.or(noWebgl).or(empty)).toBeVisible({ timeout: 20_000 });
  });

  test("the week slider narrows the range and says which weeks are shown", async ({ page }) => {
    await loginAs(page, "exec@4core.local");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /W\d+ – W\d+/ }).click();
    const group = page.getByRole("group", { name: "Weeks" });
    await expect(group).toBeVisible();
    const last = group.getByRole("slider", { name: "Weeks: last" });
    if (Number(await last.getAttribute("max")) > 0) {
      await last.focus();
      await page.keyboard.press("ArrowLeft");
      await expect(group).toContainText("–");
    }
  });
});
