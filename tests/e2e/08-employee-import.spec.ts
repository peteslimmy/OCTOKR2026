import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { answerStepUpIfAsked, expectNoA11yViolations, loginAs, query } from "./helpers";

/**
 * The employee import wizard end to end as an Administrator: upload, column matching, per-row explanations, inline correction,
 * policy choice, confirmation, the result and the history, plus the refusals around it.
 */
const ADMIN = "admin@4core.local";
const tag = Date.now().toString(36);
const mail = (n: string) => `wiz-${tag}-${n}@example.test`;
const csv = [
  "Work Email,Given Name,Surname,BU Code,Employment Status",
  `${mail("good")},Gia,Good,HQ,Active`,
  `${mail("badbu")},Bo,Badunit,NOWHERE,`,
  `${mail("good")},Dup,Licate,HQ,`,
  `${mail("formula")},=HYPERLINK("http://evil"),Formula,HQ,`,
  `${ADMIN},Existing,Admin,HQ,Active`,
].join("\r\n");

test.describe.serial("employee import wizard", () => {
  test("is reachable only by people who manage users", async ({ page }) => {
    await loginAs(page, "lead.eng@4core.local");
    await page.goto("/admin/import");
    await expect(page.getByText("You do not have access to bulk import")).toBeVisible();
    await expect(page.locator("#import-file")).toHaveCount(0);
  });

  test("explains each row, lets the person fix problems in place, and imports only when everything is valid", async ({ page }) => {
    await loginAs(page, ADMIN);
    await page.goto("/admin/people");
    await page.getByRole("link", { name: "Import employees" }).click();
    await expect(page.getByRole("heading", { name: "Import employees", level: 1 })).toBeVisible();
    await expectNoA11yViolations(page, "import: choose file");
    await expect(page.getByRole("listitem").filter({ hasText: "Choose file" })).toHaveAttribute("aria-current", "step");

    // a disguised file is refused with a clear message and the wizard stays on step 1
    await page.locator("#import-file").setInputFiles({ name: "fake.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("not a workbook") });
    await expect(page.locator("main [role=alert]")).toContainText("does not look like a real .xlsx");

    await page.locator("#import-file").setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByRole("heading", { name: "Match your columns" })).toBeVisible();
    await expect(page.getByLabel("Email (required)")).toHaveValue("0");
    await expect(page.getByLabel("Business Unit (optional)")).toHaveValue("3");
    await expect(page.getByLabel("Status (optional)")).toHaveValue("4");
    await expectNoA11yViolations(page, "import: match columns");
    await page.getByLabel("Status (optional)").selectOption("");
    await page.getByLabel("Status (optional)").selectOption({ label: "Employment Status" });
    await page.getByRole("button", { name: "Check my data" }).click();

    // review: three rows are blocked, one is a conflict
    await expect(page.getByRole("heading", { name: "Check and fix" })).toBeVisible();
    const summary = page.getByRole("list", { name: "Summary" });
    await expect(summary.getByRole("listitem").filter({ hasText: "Blocked by errors" })).toContainText("3");
    await expect(page.getByRole("button", { name: /Fix 3 blocked rows to continue/ })).toBeDisabled();
    const table = page.getByRole("table", { name: /Rows in the file/ });
    await expect(table).toContainText("No active Business Unit has this code or name.");
    await expect(table).toContainText("This email already appears on row 1.");
    await expect(table).toContainText("starts with a formula character");
    await expect(table).toContainText("already exists and will be left as they are");
    await expectNoA11yViolations(page, "import: review with errors");

    // the error report is a formula-safe CSV
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Error report" }).click()]);
    const report = readFileSync(await dl.path(), "utf8");
    expect(report).toContain("Row,Email,Field,Class,Problem");
    expect(report).not.toMatch(/(^|,)[=+@]/m);

    // filters
    await page.getByRole("button", { name: "Errors", exact: true }).click();
    await expect(table.locator("tbody tr")).toHaveCount(3);
    await page.getByRole("button", { name: "All", exact: true }).click();

    // fix rows 2, 3 and 4 in place
    const fix = async (rowNo: number, patch: Record<string, string>) => {
      await page.getByRole("button", { name: `Edit row ${rowNo}` }).click();
      for (const [label, value] of Object.entries(patch)) await page.getByLabel(label, { exact: true }).fill(value);
      await page.getByRole("button", { name: "Save and check again" }).click();
      await expect(page.getByRole("button", { name: `Edit row ${rowNo}` })).toBeVisible();
    };
    await fix(2, { "Business Unit": "hq" });
    await expect(summary.getByRole("listitem").filter({ hasText: "Blocked by errors" })).toContainText("2");
    await fix(3, { Email: mail("second") });
    await fix(4, { "First name": "Fran" });
    await expect(summary.getByRole("listitem").filter({ hasText: "Blocked by errors" })).toContainText("0");

    // policy: updating existing people changes the plan live
    await page.getByLabel(/Update people who already exist/).check();
    await expect(table).toContainText("will be updated");
    await page.getByLabel(/Skip people who already exist/).check();
    await expect(table).toContainText("Already exists; skipped.");

    await page.getByRole("button", { name: "Continue to confirm" }).click();
    await expect(page.getByRole("heading", { name: "Confirm the import" })).toBeVisible();
    await expect(page.getByText("Nothing has been saved yet.")).toBeVisible();
    expect((await query<{ n: number }>("select count(*)::int n from employees where email like $1", [`wiz-${tag}-%`]))[0].n).toBe(0);
    await expectNoA11yViolations(page, "import: confirm");

    await page.getByRole("button", { name: /Import 4 people/ }).click();
    await answerStepUpIfAsked(page, ADMIN);
    await expect(page.getByRole("heading", { name: "Import finished" })).toBeVisible();
    await expect(page.getByText("4 added, 0 updated, 0 unchanged, 1 skipped.")).toBeVisible();
    await expectNoA11yViolations(page, "import: result");
    expect((await query<{ n: number }>("select count(*)::int n from employees where email like $1", [`wiz-${tag}-%`]))[0].n).toBe(4);
    expect((await query<{ n: number }>("select count(*)::int n from audit_logs where action = 'EMPLOYEE_IMPORT_COMMITTED'"))[0].n).toBeGreaterThanOrEqual(1);
  });

  test("importing the same file again is safe, and the history lists both imports", async ({ page }) => {
    await loginAs(page, ADMIN);
    await page.goto("/admin/import");
    await page.locator("#import-file").setInputFiles({ name: "again.csv", mimeType: "text/csv", buffer: Buffer.from(`email,first_name,last_name,business_unit\r\n${mail("good")},Gia,Good,HQ\r\n`) });
    await page.getByRole("button", { name: "Check my data" }).click();
    await expect(page.getByRole("table", { name: /Rows in the file/ })).toContainText("Already exists; skipped.");
    await page.getByLabel(/Update people who already exist/).check();
    await expect(page.getByRole("table", { name: /Rows in the file/ })).toContainText("Already exists with the same details");
    await page.getByRole("button", { name: "Continue to confirm" }).click();
    await page.getByRole("button", { name: /Import 0 people/ }).click();
    await answerStepUpIfAsked(page, ADMIN);
    await expect(page.getByText("0 added, 0 updated, 1 unchanged, 0 skipped.")).toBeVisible();
    await page.goto("/admin/import");
    await expect(page.getByRole("table", { name: "Recent employee imports" }).locator("tbody tr")).toHaveCount(2);
    await expect(page.getByRole("table", { name: "Recent employee imports" })).toContainText("people.csv");
  });

  test("works on a phone: no sideways page scroll through the steps", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page, ADMIN);
    await page.goto("/admin/import");
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fits()).toBe(true);
    await page.locator("#import-file").setInputFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByRole("heading", { name: "Match your columns" })).toBeVisible();
    expect(await fits()).toBe(true);
    await page.getByRole("button", { name: "Check my data" }).click();
    await expect(page.getByRole("heading", { name: "Check and fix" })).toBeVisible();
    expect(await fits()).toBe(true);
  });
});

test.describe.serial("Business Unit import wizard", () => {
  const code = (n: string) => `W${tag}${n}`.toUpperCase().slice(0, 18);
  const units = [
    "Unit Code,Unit Name,Files Weekly Reports,Status",
    `${code("a")},Wizard Alpha,Yes,Active`,
    `${code("b")},=SUM(A1),No,`,
    `${code("a")},Wizard Alpha again,,`,
    `HQ,Headquarters,No,Active`,
  ].join("\r\n");

  test("is offered from Administration and closed to people without Business Unit management", async ({ page }) => {
    await loginAs(page, "hr@4core.local");
    await page.goto("/admin/import/business-units");
    await expect(page.getByText("You do not have access to bulk import")).toBeVisible();
    await loginAs(page, ADMIN);
    await page.goto("/admin/units");
    await page.getByRole("link", { name: "Import from a file" }).click();
    await expect(page.getByRole("heading", { name: "Import Business Units", level: 1 })).toBeVisible();
    await expectNoA11yViolations(page, "business unit import: choose file");
  });

  test("explains rows in its own words, takes inline fixes and imports atomically", async ({ page }) => {
    await loginAs(page, ADMIN);
    await page.goto("/admin/import/business-units");
    await page.locator("#import-file").setInputFiles({ name: "units.csv", mimeType: "text/csv", buffer: Buffer.from(units) });
    await expect(page.getByLabel("Code (required)")).toHaveValue("0");
    await expect(page.getByLabel("Name (required)")).toHaveValue("1");
    await page.getByRole("button", { name: "Check my data" }).click();
    const table = page.getByRole("table", { name: /Rows in the file/ });
    await expect(table).toContainText("starts with a formula character");
    await expect(table).toContainText("This code already appears on row 1.");
    await expect(table).toContainText("This unit already exists and will be left as it is.");
    await expect(page.getByRole("button", { name: /Fix 2 blocked rows to continue/ })).toBeDisabled();
    await expectNoA11yViolations(page, "business unit import: review");
    const fix = async (rowNo: number, patch: Record<string, string>) => {
      await page.getByRole("button", { name: `Edit row ${rowNo}` }).click();
      for (const [label, value] of Object.entries(patch)) await page.getByLabel(label, { exact: true }).fill(value);
      await page.getByRole("button", { name: "Save and check again" }).click();
      await expect(page.getByRole("button", { name: `Edit row ${rowNo}` })).toBeVisible();
    };
    await fix(2, { Name: "Wizard Bravo" });
    await fix(3, { Code: code("c") });
    await page.getByRole("button", { name: "Continue to confirm" }).click();
    await page.getByRole("button", { name: /Import 3 units/ }).click();
    await answerStepUpIfAsked(page, ADMIN);
    await expect(page.getByRole("heading", { name: "Import finished" })).toBeVisible();
    await expect(page.getByText("3 added, 0 updated, 0 unchanged, 1 skipped.")).toBeVisible();
    const rows = await query<{ code: string; reports_weekly: boolean }>("select code, reports_weekly from business_units where code like $1 order by code", [`W${tag.toUpperCase()}%`]);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.code === code("b"))?.reports_weekly).toBe(false);
    await expectNoA11yViolations(page, "business unit import: result");
  });

  test("history shows only Business Unit imports", async ({ page }) => {
    await loginAs(page, ADMIN);
    await page.goto("/admin/import/business-units");
    const t = page.getByRole("table", { name: "Recent Business Unit imports" });
    await expect(t.locator("tbody tr")).toHaveCount(1);
    await expect(t).toContainText("units.csv");
    await expect(t).not.toContainText("people.csv");
  });
});
