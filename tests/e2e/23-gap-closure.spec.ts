import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs } from "./helpers";

/** Gap-closure phases A to C (ADR-078 to 080): the roster list on People, the strategy import and the sign-in import. */
test.describe.serial("gap closure", () => {
  test("People lists every employee with the roster state and a roster switch", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/people");
    await expect(page.getByRole("table", { name: "All employees" })).toBeVisible();
    await expect(page.getByRole("table", { name: "All employees" }).getByRole("button", { name: /roster/ }).first()).toBeVisible();
    await expectNoA11yViolations(page, "people with roster");
  });

  test("the strategy import is for the Super Admin; a sheet with a missing column is explained", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/import/strategy");
    await expect(page.getByText("Only a Super Admin can import strategy")).toBeVisible();

    await loginAs(page, "superadmin@4core.local");
    await page.goto("/admin/import/strategy");
    await expect(page.getByRole("heading", { name: "Import strategy", level: 1 })).toBeVisible();
    await expectNoA11yViolations(page, "strategy import");
    await page.getByLabel(/Spreadsheet/).setInputFiles({ name: "s.csv", mimeType: "text/csv", buffer: Buffer.from("Year,Quarter\n2019,1\n") });
    await expect(page.getByText(/needs these columns/).first()).toBeVisible();
    await page.getByLabel(/Spreadsheet/).setInputFiles({ name: "s.csv", mimeType: "text/csv", buffer: Buffer.from("Year,Quarter,Objective,KR,KR title,Sub-KR,Sub-KR title\n2019,1,Obj,1,K1,1,S1\n") });
    await expect(page.getByText("The file cannot be imported yet")).toBeVisible();
    await expect(page.getByRole("cell", { name: /3 or 4|has 1 key results/ }).first()).toBeVisible();
  });

  test("the sign-in import explains an unknown person and an unknown role", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/import/sign-ins");
    await expect(page.getByRole("heading", { name: "Import sign-ins and roles", level: 1 })).toBeVisible();
    await expectNoA11yViolations(page, "sign-in import");
    await page.getByLabel(/Spreadsheet/).setInputFiles({ name: "s.csv", mimeType: "text/csv", buffer: Buffer.from("Email,Roles\nnobody@example.test,Wizard\n") });
    await expect(page.getByRole("cell", { name: /is not a role/ })).toBeVisible();
  });
});
