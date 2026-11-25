import { expect, test } from "@playwright/test";
import { expectNoA11yViolations, loginAs } from "./helpers";

/**
 * Retiring a Business Unit goal (ADR-134): the BU Lead presses Retire, picks the executive by name and gives a justification; the goal stays active
 * and shows who must approve; the executive rejects with a comment (the goal stays); the lead asks again; the executive approves and the goal is retired.
 */
test.describe.configure({ mode: "serial" });
const ex = expect.configure({ timeout: 30_000 });
const title = `Retirement journey goal ${Date.now()}`;

const goalRow = (page: import("@playwright/test").Page) => page.getByRole("listitem").filter({ hasText: title });

test("the lead asks the executive Eve to retire a goal; it stays active and shows who must approve", async ({ page }) => {
  await loginAs(page, "lead.eng@4core.local");
  await page.goto("/bu-goals");
  await page.getByLabel("New Business Unit goal").fill(title);
  await page.getByRole("button", { name: "Add goal" }).click();
  await ex(goalRow(page)).toBeVisible();
  await goalRow(page).getByRole("button", { name: "Retire", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await ex(dialog.getByText("Executive who decides")).toBeVisible();
  await dialog.getByLabel(/Executive who decides/).selectOption({ label: "Eve Executive (Executive)" });
  await expect(dialog.getByRole("button", { name: "Send for approval" })).toBeDisabled();   // the justification is required
  await dialog.getByLabel(/Justification/).fill("The unit moved to another priority");
  await dialog.getByRole("button", { name: "Send for approval" }).click();
  await ex(goalRow(page).getByText("Retirement pending approval by Eve Executive").first()).toBeVisible();
  await expect(goalRow(page).getByText("Retired", { exact: true })).toHaveCount(0);          // until approval the goal is exactly as it was
  await expect(goalRow(page).getByRole("button", { name: "Retire", exact: true })).toHaveCount(0);        // one open request per goal
  await expectNoA11yViolations(page, "BU goals with a pending retirement");
});

test("the chosen executive rejects with a comment and the goal stays active", async ({ page }) => {
  await loginAs(page, "exec@4core.local");
  await page.goto("/bu-goals");
  const item = page.getByTestId("retirement-request").filter({ hasText: title });
  await ex(item).toBeVisible();
  await expect(item.getByText("The unit moved to another priority")).toBeVisible();
  await item.getByRole("button", { name: "Reject" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Reject" })).toBeDisabled();               // a rejection needs a comment
  await dialog.getByLabel(/Comment/).fill("Still needed until the quarter closes");
  await dialog.getByRole("button", { name: "Reject" }).click();
  await ex(page.getByText("Retirement rejected. The goal stays active.")).toBeVisible();
});

test("the lead sees the rejection, asks again, and the executive's approval retires the goal", async ({ page }) => {
  await loginAs(page, "lead.eng@4core.local");
  await page.goto("/bu-goals");
  await ex(page.getByText("Comment: Still needed until the quarter closes")).toBeVisible();
  await expect(goalRow(page).getByText("Retired", { exact: true })).toHaveCount(0);
  await goalRow(page).getByRole("button", { name: "Retire", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Executive who decides/).selectOption({ label: "Eve Executive (Executive)" });
  await dialog.getByLabel(/Justification/).fill("The quarter is nearly over and nothing depends on it");
  await dialog.getByRole("button", { name: "Send for approval" }).click();
  await ex(goalRow(page).getByText("Retirement pending approval by Eve Executive").first()).toBeVisible();

  await loginAs(page, "exec@4core.local");
  await page.goto("/bu-goals");
  const item = page.getByTestId("retirement-request").filter({ hasText: "nothing depends on it" });
  await item.getByRole("button", { name: "Approve" }).click();
  await ex(page.getByText("Approved. The goal is retired.")).toBeVisible();

  await loginAs(page, "lead.eng@4core.local");
  await page.goto("/bu-goals");
  await ex(goalRow(page).getByText("Retired", { exact: true })).toBeVisible();
  await expect(page.getByText("Approved: goal retired").first()).toBeVisible();
});
