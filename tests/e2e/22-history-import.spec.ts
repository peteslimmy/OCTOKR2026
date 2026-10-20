import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs, query } from "./helpers";

/** Historical reports (ADR-077): Super Admin only; problems come back with their row; a rehearsal shows recomputed scores and saves nothing. The commit is proven in the database tests. */
const HEADER = "Year,Week,BU/Depart,SubKR Category,Goal,Task 1,Status 1,Task 2,Status 2\n";

test.describe.serial("historical import", () => {
  test("an Admin cannot see it; the Super Admin can read a sheet, fix problems and rehearse without saving", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/import/history");
    await expect(page.getByText("Only a Super Admin can load historical reports")).toBeVisible();

    await loginAs(page, "superadmin@4core.local");
    await page.goto("/admin/import/history");
    await expect(page.getByRole("heading", { name: "Import historical reports", level: 1 })).toBeVisible();
    await expectNoA11yViolations(page, "history import");

    const input = page.getByLabel(/Spreadsheet/);
    await input.setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from(`${HEADER}2025,3,Nowhere,1.1,G,T,Done,,\n`) });
    await expect(page.getByText("Business Units not found:")).toBeVisible();
    await expect(page.getByRole("cell", { name: /is not a Business Unit/ })).toBeVisible();

    const unit = (await query<{ code: string }>("select code from business_units where code <> 'HQ' order by code limit 1"))[0].code;
    const marker = Date.now().toString(36);
    const reports = (await query<{ n: number }>("select count(*)::int n from weekly_reports"))[0].n;
    await input.setInputFiles({ name: "good.csv", mimeType: "text/csv", buffer: Buffer.from(`${HEADER}2025,3,${unit},1.1,Goal ${marker},Brief,Done,Ship,Not Done\n`) });
    await expect(page.getByText(/passed every check/)).toBeVisible();
    await page.getByRole("button", { name: "Rehearse the import" }).click();
    await expect(page.getByText("Rehearsal result (nothing was saved)")).toBeVisible();
    await expect(page.getByRole("table", { name: "Recomputed quarterly scores" })).toBeVisible();
    await expectNoA11yViolations(page, "history rehearsal");

    const importButton = page.getByRole("button", { name: "Import history" });
    await expect(importButton).toBeDisabled();
    await page.getByLabel(/Type IMPORT HISTORY/).fill("IMPORT HISTORY");
    await expect(importButton).toBeEnabled();
    expect((await query<{ n: number }>("select count(*)::int n from weekly_reports"))[0].n).toBe(reports);       // nothing was written
  });
});
