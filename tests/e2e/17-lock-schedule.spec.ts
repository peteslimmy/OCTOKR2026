import { expect, test, type Page } from "@playwright/test";
import { answerStepUpIfAsked, expectNoA11yViolations, loginAs, query } from "./helpers";

/** Lock times are a setting, changed by an approved request, and never applied to a week that already exists (ADR-070). */
async function propose(page: Page, v: { cDay: string; cTime: string; fDay: string; fTime: string; fOff: string; reason: string }) {
  await loginAs(page, "admin@4core.local");
  await page.goto("/admin/settings");
  const card = page.locator("div.rounded-xl").filter({ has: page.getByRole("heading", { name: "Reporting window and locks" }) });
  await card.getByRole("group", { name: "Content lock" }).getByLabel("Day").selectOption({ label: v.cDay });
  await card.getByRole("group", { name: "Content lock" }).getByLabel("Time (HH:MM)").fill(v.cTime);
  await card.getByRole("group", { name: "Final lock" }).getByLabel("Day").selectOption({ label: v.fDay });
  await card.getByRole("group", { name: "Final lock" }).getByLabel("Time (HH:MM)").fill(v.fTime);
  await card.getByRole("group", { name: "Final lock" }).getByLabel("Which week").selectOption({ label: v.fOff });
  await card.getByLabel("Reason for the approver").fill(v.reason);
  await card.getByRole("button", { name: "Send for approval" }).click();
  return card;
}
async function approve(page: Page) {
  await loginAs(page, "superadmin@4core.local");
  await page.goto("/admin/approvals");
  const item = page.getByRole("list", { name: "Configuration changes" }).getByRole("listitem").filter({ hasText: "Waiting for approval" }).filter({ hasText: "Change when reports lock" }).first();
  await item.getByRole("button", { name: /^Approve/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve and apply" }).click();
  await answerStepUpIfAsked(page, "superadmin@4core.local");
  await expect(page.getByText("Approved and applied.")).toBeVisible();
}

test.describe.serial("lock schedule", () => {
  test("the screen shows the schedule in force and says what a change would do", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/settings");
    const card = page.locator("div.rounded-xl").filter({ has: page.getByRole("heading", { name: "Reporting window and locks" }) });
    await expect(card).toContainText("Tuesday 18:00 WAT");
    await expect(card).toContainText("the following Tuesday 11:00 WAT");
    await expect(card).toContainText("weeks already generated keep the times they have");
    await expectNoA11yViolations(page, "administration with lock times");
  });

  test("a final lock that comes before the content lock is refused with a plain reason", async ({ page }) => {
    const card = await propose(page, { cDay: "Tuesday", cTime: "18:00", fDay: "Tuesday", fTime: "09:00", fOff: "In the week itself", reason: "rehearsal" });
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(page.getByText(/final lock must come at least an hour after the content lock/i)).toBeVisible();
    expect(await query("select 1 from reporting_schedule_versions")).toHaveLength(1);
    await expect(card.getByRole("button", { name: "Send for approval" })).toBeVisible();
  });

  test("a change is asked for, approved by someone else, and leaves every generated week as it was", async ({ page }) => {
    const before = await query<{ n: number }>("select count(*)::int n from reporting_weeks where schedule_version_id = (select id from reporting_schedule_versions where version = 1)");
    await propose(page, { cDay: "Wednesday", cTime: "17:30", fDay: "Wednesday", fTime: "10:00", fOff: "The week after", reason: "Management moved the deadline" });
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(page.getByText("Sent for approval.")).toBeVisible();
    expect(await query("select 1 from reporting_schedule_versions")).toHaveLength(1);                         // asking changes nothing
    await approve(page);
    expect((await query<{ version: number }>("select version from reporting_schedule_versions order by version")).map((r) => r.version)).toEqual([1, 2]);
    const after = await query<{ n: number }>("select count(*)::int n from reporting_weeks where schedule_version_id = (select id from reporting_schedule_versions where version = 1)");
    expect(after[0].n).toBe(before[0].n);                                                                        // no week moved to the new version
    expect((await query("select 1 from reporting_weeks where schedule_version_id = (select id from reporting_schedule_versions where version = 2)"))).toHaveLength(0);
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/settings");
    const card = page.locator("div.rounded-xl").filter({ has: page.getByRole("heading", { name: "Reporting window and locks" }) });
    await expect(card).toContainText("Wednesday 17:30 WAT");
    await card.getByText(/^History \(2 versions\)/).click();                                                // the history is folded away until asked for
    await expect(card.getByRole("list", { name: "Lock schedule history" })).toContainText("v1");
  });

  test("the original schedule is put back the same way, so later specs run as before", async ({ page }) => {
    await propose(page, { cDay: "Tuesday", cTime: "18:00", fDay: "Tuesday", fTime: "11:00", fOff: "The week after", reason: "Restoring the original deadline" });
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(page.getByText("Sent for approval.")).toBeVisible();
    await approve(page);
    const active = (await query<{ version: number; c: string; f: string }>("select version, to_char(content_lock_time, 'HH24:MI') c, to_char(final_lock_time, 'HH24:MI') f from reporting_schedule_versions order by version desc limit 1"))[0];
    expect(active).toEqual({ version: 3, c: "18:00", f: "11:00" });
  });
});
