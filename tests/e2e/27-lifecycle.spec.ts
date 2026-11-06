import { expect, test } from "@playwright/test";
import { loginAs, query } from "./helpers";

/**
 * The people lifecycle in a real browser: an Admin moves a BU Lead to another unit and records why, the person's journey shows it, the person sees their own journey, and the move
 * changes no report. The person is put back at the end so later tests find the seeded unit.
 */
test.describe.configure({ mode: "serial" });
const ex = expect.configure({ timeout: 30_000 });
const EMAIL = "lead.eng2@4core.local";
let employeeId = "", engId = "", salesId = "", engName = "", salesName = "";
const reason = `Cover Sales for a quarter ${Date.now()}`;

test.beforeAll(async () => {
  const p = (await query<{ eid: string; bu: string; name: string }>("select e.id eid, e.business_unit_id bu, b.name from users u join employees e on e.id = u.employee_id join business_units b on b.id = e.business_unit_id where u.email = $1", [EMAIL]))[0];
  employeeId = p.eid; engId = p.bu; engName = p.name;
  const s = (await query<{ id: string; name: string }>("select b.id, b.name from users u join employees e on e.id = u.employee_id join business_units b on b.id = e.business_unit_id where u.email = 'lead.sales@4core.local'"))[0];
  salesId = s.id; salesName = s.name;
});

test("Admin moves a BU Lead to another unit with a reason; nothing in the reports changes", async ({ page }) => {
  const reportsBefore = JSON.stringify(await query("select id, business_unit_id, status, submission_status from weekly_reports order by id"));
  await loginAs(page, "admin@4core.local");
  await page.goto("/admin/people", { timeout: 90_000 });
  const row = page.getByRole("region", { name: "Application users" }).getByRole("row").filter({ hasText: EMAIL });
  await ex(row).toBeVisible({ timeout: 60_000 });
  await ex(async () => { await row.getByRole("button", { name: "Move or promote" }).click(); await expect(page.getByRole("dialog")).toBeVisible({ timeout: 3_000 }); }).toPass({ timeout: 60_000 });
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Business unit").selectOption(salesId);
  await expect(dialog.getByRole("button", { name: "Save change" })).toBeDisabled();                       // a reason is required
  await dialog.getByLabel("Reason").fill(reason);
  await dialog.getByRole("button", { name: "Save change" }).click();
  await expect(page.getByText(/Saved\. The change is in the person's journey/)).toBeVisible({ timeout: 90_000 });
  expect((await query<{ business_unit_id: string }>("select business_unit_id from employees where id = $1", [employeeId]))[0].business_unit_id).toBe(salesId);
  expect(JSON.stringify(await query("select id, business_unit_id, status, submission_status from weekly_reports order by id"))).toBe(reportsBefore);
});

test("the journey shows the move, who did it and why; the person sees their own; others cannot", async ({ page }) => {
  await loginAs(page, "admin@4core.local");
  await page.goto(`/admin/people/${employeeId}`, { timeout: 90_000 });
  await ex(page.getByRole("heading", { level: 1 })).toContainText("Ezra");
  await ex(page.getByText(`Moved from ${engName} to ${salesName}`)).toBeVisible();
  await expect(page.getByText(`Reason: ${reason}`)).toBeVisible();
  await expect(page.getByText(/By .*Admin/).first()).toBeVisible();

  await loginAs(page, EMAIL);
  await page.goto("/account/journey", { timeout: 90_000 });
  await ex(page.getByText(`Moved from ${engName} to ${salesName}`)).toBeVisible();
  const own = await page.request.get(`/api/v1/employees/${employeeId}/journey`);
  expect(own.status()).toBe(200);
  const people = await page.goto("/admin/people", { timeout: 90_000 });
  void people;
  await ex(page.getByText("People management is not available for your role.")).toBeVisible();      // a BU Lead cannot manage people
  const other = await page.request.get(`/api/v1/employees/${(await query<{ id: string }>("select e.id from users u join employees e on e.id = u.employee_id where u.email = 'lead.sales@4core.local'"))[0].id}/journey`);
  expect(other.status()).toBe(404);                                                                       // nor read someone else's journey
  const denied = await page.request.post(`/api/v1/employees/${employeeId}/lifecycle`, { data: { toBusinessUnitId: engId, reason: "x" } });
  expect(denied.status()).toBe(403);
});

test("put back: the Admin moves the person back, and the journey keeps both moves", async ({ page }) => {
  await loginAs(page, "admin@4core.local");
  await page.goto("/admin/people", { timeout: 90_000 });
  const row = page.getByRole("region", { name: "Application users" }).getByRole("row").filter({ hasText: EMAIL });
  await ex(async () => { await row.getByRole("button", { name: "Move or promote" }).click(); await expect(page.getByRole("dialog")).toBeVisible({ timeout: 3_000 }); }).toPass({ timeout: 60_000 });
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Business unit").selectOption(engId);
  await dialog.getByLabel("Reason").fill("Cover ended");
  await dialog.getByRole("button", { name: "Save change" }).click();
  await expect(page.getByText(/Saved\. The change is in the person's journey/)).toBeVisible({ timeout: 90_000 });
  const moves = await query<{ n: number }>("select count(*)::int n from employee_lifecycle_events where employee_id = $1 and event_type = 'TRANSFERRED'", [employeeId]);
  expect(moves[0].n).toBeGreaterThanOrEqual(2);
});
