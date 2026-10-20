import { expect, test } from "@playwright/test";
import { answerStepUpIfAsked, expectNoA11yViolations, loginAs, query } from "./helpers";

/** Changes to governance settings are asked for by one person and approved by a different one (ADR-068). */
const code = `E2E${Date.now().toString(36).toUpperCase().slice(-6)}`;

test.describe.serial("configuration approval", () => {
  test("HR asks for a violation type; nothing exists until an Admin approves; HR cannot decide and the requester can only withdraw", async ({ page }) => {
    await loginAs(page, "hr@4core.local");
    await page.goto("/governance/violations");
    await page.getByRole("button", { name: "Add violation type" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Code").fill(code);
    await dialog.getByLabel("Name").fill("Late to the weekly check-in");
    await dialog.getByLabel("Default fine (₦)").fill("1500");
    await dialog.getByLabel("Reason for the approver").fill("Agreed by management on 14 October");
    await dialog.getByRole("button", { name: "Send for approval" }).click();
    await expect(page.getByText("Sent for approval.")).toBeVisible();
    expect(await query("select 1 from violation_types where code = $1", [code])).toHaveLength(0);       // asking changes nothing

    await page.goto("/admin/approvals");
    const item = page.getByRole("list", { name: "Configuration changes" }).getByRole("listitem").filter({ hasText: "Waiting for approval" }).first();
    await expect(item).toContainText("Add or change a violation type and its fine");
    await expect(item).toContainText("You made this request, so someone else must decide it.");
    await expect(item.getByRole("button", { name: /^Approve/ })).toHaveCount(0);
    await expect(item.getByRole("button", { name: /^Withdraw/ })).toBeVisible();
    await expectNoA11yViolations(page, "approvals queue as the requester");
  });

  test("an Admin approves it; the type then exists with the agreed fine and the requester is told", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/approvals");
    const item = page.getByRole("list", { name: "Configuration changes" }).getByRole("listitem").filter({ hasText: "Waiting for approval" }).filter({ hasText: code }).first()
      .or(page.getByRole("list", { name: "Configuration changes" }).getByRole("listitem").filter({ hasText: "Waiting for approval" }).first());
    await expect(item.getByRole("table")).toContainText("1500");
    await item.getByRole("button", { name: /^Approve/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve and apply" }).click();
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(page.getByText("Approved and applied.")).toBeVisible();
    const row = (await query<{ default_fine: string }>("select default_fine from violation_types where code = $1", [code]))[0];
    expect(Number(row.default_fine)).toBe(1500);
    const told = await query("select 1 from notifications n join users u on u.id = n.user_id where u.email = 'hr@4core.local' and n.event_type = 'CONFIG_CHANGE_DECIDED'");
    expect(told.length).toBeGreaterThanOrEqual(1);
    await expectNoA11yViolations(page, "approvals queue after a decision");
  });

  test("a Super Admin can apply a change in one step in an emergency; it is audited and the others are alerted", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/settings");
    const rateForm = page.locator("form").filter({ has: page.getByLabel("Penalty rate (%)") });
    await rateForm.getByLabel("Penalty rate (%)").fill("7.5");
    await rateForm.getByLabel("Reason for the approver").fill("Emergency rehearsal");
    await rateForm.getByRole("button", { name: "Send for approval" }).click();
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(page.getByText("Sent for approval.")).toBeVisible();

    await loginAs(page, "superadmin@4core.local");
    await page.goto("/admin/approvals");
    const item = page.getByRole("list", { name: "Configuration changes" }).getByRole("listitem").filter({ hasText: "Waiting for approval" }).first();
    await item.getByRole("button", { name: /^Apply in an emergency/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Reason \(required, at least 10 characters\)/).fill("short");
    await expect(dialog.getByRole("button", { name: "Apply now" })).toBeDisabled();
    await dialog.getByLabel(/Reason \(required, at least 10 characters\)/).fill("Rate must change before the next lock");
    await dialog.getByRole("button", { name: "Apply now" }).click();
    await answerStepUpIfAsked(page, "superadmin@4core.local");
    await expect(page.getByText("Change applied. The other approvers were alerted.")).toBeVisible();
    expect(Number((await query<{ rate: string }>("select rate from integrity_penalty_configurations where effective_to is null"))[0].rate)).toBeCloseTo(0.075, 5);
    expect((await query("select 1 from audit_logs where action = 'CONFIG_CHANGE_EMERGENCY'")).length).toBeGreaterThanOrEqual(1);
    const alerted = await query("select 1 from notifications n join users u on u.id = n.user_id where u.email = 'admin@4core.local' and n.event_type = 'CONFIG_CHANGE_EMERGENCY'");
    expect(alerted.length).toBeGreaterThanOrEqual(1);
    await query("select set_integrity_penalty_rate(id, 0.05) from users where email = 'admin@4core.local'");   // put the seeded rate back for later specs
  });

  test("a Business Unit Lead does not see approvals", async ({ page }) => {
    await loginAs(page, "lead.eng@4core.local");
    await page.goto("/admin/approvals");
    await expect(page.getByText("Approvals are not available for your role")).toBeVisible();
  });
});
