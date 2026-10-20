import { expect, test, type Page } from "@playwright/test";
import { answerStepUpIfAsked, expectNoA11yViolations, loginAs, query } from "./helpers";

/** Roles are created, changed and deleted in the application, as approved changes (ADR-069). */
const code = `E2E_${Date.now().toString(36).toUpperCase().slice(-5)}`;

async function approve(page: Page, who: string, text: RegExp | string) {
  await loginAs(page, who);
  await page.goto("/admin/approvals");
  const item = page.getByRole("list", { name: "Configuration changes" }).getByRole("listitem").filter({ hasText: "Waiting for approval" }).filter({ hasText: text }).first();
  await item.getByRole("button", { name: /^Approve/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve and apply" }).click();
  await answerStepUpIfAsked(page, who);
  await expect(page.getByText("Approved and applied.")).toBeVisible();
}

test.describe.serial("role management", () => {
  test("an Admin asks for a new role; it does not exist until a Super Admin approves; then it is listed", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/roles");
    await expect(page.getByRole("list", { name: "Roles" })).toContainText("Super Admin");
    await expectNoA11yViolations(page, "roles");
    await page.getByRole("button", { name: "New role" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Code").fill(code);
    await dialog.getByLabel("Name", { exact: true }).fill("Reviewer (read only)");
    await dialog.getByLabel("Description").fill("Reads reports and strategy");
    await dialog.getByLabel("reports.view", { exact: false }).first().check();
    await dialog.getByLabel("Reason for the approver").fill("Needed for the audit committee");
    await expectNoA11yViolations(page, "role editor");
    await dialog.getByRole("button", { name: "Send for approval" }).click();
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(page.getByText("Sent for approval.")).toBeVisible();
    expect(await query("select 1 from roles where code = $1", [code])).toHaveLength(0);

    await approve(page, "superadmin@4core.local", "Create, change or delete a role");
    expect(await query("select 1 from roles where code = $1", [code])).toHaveLength(1);
    await page.goto("/admin/roles");
    await expect(page.getByRole("list", { name: "Roles" })).toContainText("Reviewer (read only)");
  });

  test("an Admin cannot give a role a permission they do not hold, and protected changes say a Super Admin must approve", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/roles");
    await page.getByRole("button", { name: /^Edit Reviewer/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("ledger.reversal.emergency", { exact: false })).toBeDisabled();           // Super Admin only
    await expect(dialog.getByText("You do not hold this permission").first()).toBeVisible();
    await dialog.getByLabel("users.manage", { exact: false }).check();                                       // the Admin holds it, but it is protected
    await expect(dialog.getByRole("note")).toContainText("only a Super Admin can approve");
    await dialog.getByLabel("Reason for the approver").fill("Trying a protected change");
    await dialog.getByRole("button", { name: "Send for approval" }).click();
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(page.getByText(/protected settings, so a Super Admin must approve it/)).toBeVisible();

    await loginAs(page, "superadmin@4core.local");
    await page.goto("/admin/approvals");
    const item = page.getByRole("list", { name: "Configuration changes" }).getByRole("listitem").filter({ hasText: "Waiting for approval" }).filter({ hasText: "users.manage" }).first();
    await expect(item.getByRole("table")).toContainText("Add: users.manage");
    await item.getByRole("button", { name: /^Reject/ }).click();
    await page.getByRole("dialog").getByLabel("Reason for rejecting (required)").fill("Not needed");
    await page.getByRole("dialog").getByRole("button", { name: "Reject request" }).click();
    await answerStepUpIfAsked(page, "superadmin@4core.local");
    await expect(page.getByText("Request rejected.")).toBeVisible();
  });

  test("a person holding the new role gets exactly its permissions, and the role can be deleted after moving them", async ({ page }) => {
    const lead = (await query<{ id: string }>("select id from users where email = 'lead.eng@4core.local'"))[0].id;
    await query("insert into user_roles (user_id, role_id) select $1, id from roles where code = $2", [lead, code]);
    expect((await query<{ ok: boolean }>("select actor_has_permission($1, 'reports.view') as ok", [lead]))[0].ok).toBe(true);

    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/roles");
    await page.getByRole("button", { name: /^Delete Reviewer/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Send for approval" })).toBeDisabled();                  // someone holds it: say where they go
    await dialog.getByLabel(/^Move the 1 person to/).selectOption({ label: "Presenter" });
    await dialog.getByLabel("Reason for the approver").fill("No longer needed");
    await dialog.getByRole("button", { name: "Send for approval" }).click();
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(page.getByText("Sent for approval.")).toBeVisible();
    await approve(page, "superadmin@4core.local", "Create, change or delete a role");
    expect(await query("select 1 from roles where code = $1", [code])).toHaveLength(0);
    const roles = (await query<{ code: string }>("select r.code from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1", [lead])).map((r) => r.code).sort();
    expect(roles).toContain("PRESENTER");
    await query("delete from user_roles where user_id = $1 and role_id = (select id from roles where code = 'PRESENTER')", [lead]);   // put the seeded person back as they were
  });

  test("the last people able to manage roles cannot be removed", async () => {
    const sa = (await query<{ id: string }>("select id from users where email = 'superadmin@4core.local'"))[0].id;
    const role = (await query<{ id: string }>("select id from roles where code = 'SUPER_ADMIN'"))[0].id;
    await expect(query("select request_config_change($1, 'ROLE_CHANGE', $2, $3::jsonb, 'trying it', gen_random_uuid()::text)", [sa, role, JSON.stringify({ action: "DELETE", moveTo: "ADMIN" })])).rejects.toThrow(/ROLE_LOCKOUT/);
  });
});
