import { expect, test } from "@playwright/test";
import { answerStepUpIfAsked, expectNoA11yViolations, loginAs, query } from "./helpers";


/** A different person opens the approvals queue and approves the first request waiting. */
async function approveFirstWaiting(page: import("@playwright/test").Page, who: string) {
  await loginAs(page, who);
  await page.goto("/admin/approvals");
  const item = page.getByRole("list", { name: "Configuration changes" }).getByRole("listitem").filter({ hasText: "Waiting for approval" }).first();
  await item.getByRole("button", { name: /^Approve/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve and apply" }).click();
  await answerStepUpIfAsked(page, who);
  await expect(page.getByText("Approved and applied.")).toBeVisible();
}

/** Reminder and email settings for administrators, the personal email choice, and notifications that lead somewhere. */
test.describe.serial("reminders and email", () => {
  test("an Admin sees how reminders and email are set up, can change them, and is told when input is wrong", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/settings");
    const card = page.locator("div.rounded-xl").filter({ has: page.getByRole("heading", { name: "Reminders and email" }) });
    await expect(card).toBeVisible();
    await expect(card.getByLabel("Hours before the content lock")).toHaveValue("24, 6");
    await expect(card.getByText(/Email goes out through: file|No email provider is configured/)).toBeVisible();
    await expect(card.getByRole("list", { name: "Email queue" })).toContainText("Sent");
    await expectNoA11yViolations(page, "administration with reminder settings");

    await card.getByLabel("Hours before the content lock").fill("100, 6");
    await card.getByLabel("Reason for the approver").fill("e2e change");
    await card.getByRole("button", { name: "Send for approval" }).click();
    await expect(card.getByRole("alert")).toContainText("between 1 and 72");

    await card.getByLabel("Hours before the content lock").fill("48, 12");
    await card.getByLabel("Most reminders one person gets per week").selectOption("3");
    await card.getByRole("button", { name: "Send for approval" }).click();
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(page.getByText("Sent for approval.")).toBeVisible();
    const waiting = (await query<{ reminder_hours: number[] }>("select reminder_hours from notification_settings"))[0];
    expect(waiting.reminder_hours).toEqual([24, 6]);                                    // asking changes nothing

    await approveFirstWaiting(page, "superadmin@4core.local");
    const row = (await query<{ reminder_hours: number[]; max_reminders_per_week: number }>("select reminder_hours, max_reminders_per_week from notification_settings"))[0];
    expect([row.reminder_hours, row.max_reminders_per_week]).toEqual([[48, 12], 3]);

    await loginAs(page, "admin@4core.local");                                            // put the defaults back, the same way
    await page.goto("/admin/settings");
    await card.getByLabel("Hours before the content lock").fill("24, 6");
    await card.getByLabel("Most reminders one person gets per week").selectOption("2");
    await card.getByLabel("Reason for the approver").fill("e2e restore");
    await card.getByRole("button", { name: "Send for approval" }).click();
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(page.getByText("Sent for approval.")).toBeVisible();
    await approveFirstWaiting(page, "superadmin@4core.local");
  });

  test("other roles do not see the settings", async ({ page }) => {
    await loginAs(page, "hr@4core.local");
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "Reminders and email" })).toHaveCount(0);
  });

  test("a notification leads to the place to act on it, and a person can turn routine email off and on", async ({ page }) => {
    const lead = (await query<{ id: string }>("select id from users where email = 'lead.eng@4core.local'"))[0].id;
    await query("select notify_users(array[$1::uuid], 'REPORT_DUE_REMINDER', 'reporting_week', 'e2e', 'Weekly report due in about 5 hours', 'Engineering has not submitted its report.', $2)", [lead, `e2e-rem-${Date.now()}`]);
    await loginAs(page, "lead.eng@4core.local");
    await page.goto("/notifications");
    const item = page.getByRole("listitem").filter({ hasText: "Weekly report due in about 5 hours" }).first();
    await expect(item.getByRole("link", { name: "Open weekly reports" })).toHaveAttribute("href", "/weekly");

    const box = page.getByLabel("Email me about time-sensitive events");
    await expect(box).toBeChecked();
    await box.uncheck();
    await expect(page.getByText("Email turned off for routine events.")).toBeVisible();
    expect((await query<{ email_enabled: boolean }>("select email_enabled from notification_preferences np join users u on u.id = np.user_id where u.email = 'lead.eng@4core.local'"))[0].email_enabled).toBe(false);
    await page.reload();
    await expect(box).not.toBeChecked();
    await expectNoA11yViolations(page, "notifications with the email choice");
    await box.check();
    await expect(page.getByText("You will get email about time-sensitive events.")).toBeVisible();
  });

  test("a queued security email is handed to the transport by the scheduler run", async () => {
    const target = (await query<{ id: string }>("select id from users where email = 'exec@4core.local'"))[0].id;
    const marker = `e2e-mail-${Date.now()}`;
    await query("select notify_users(array[$1::uuid], 'PASSWORD_CHANGED', 'user', $1::text, $2, 'Test body', $2)", [target, marker]);
    expect((await query<{ status: string }>("select status from email_outbox where subject = $1", [marker]))[0].status).toBe("PENDING");
    // each run hands over at most 25 mails, oldest first, and earlier tests leave reminders queued, so run until ours has gone.
    // (The endpoint has also been seen to answer 500 once in a while for reasons not yet found, see the implementation notes: a retry is allowed.)
    let status = "PENDING";
    for (let run = 0; run < 12 && status === "PENDING"; run++) {
      for (let i = 0; i < 3; i++) {
        const r = await fetch(`${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/api/internal/jobs/run`, { method: "POST", headers: { "x-jobs-secret": process.env.JOBS_SECRET ?? "" } });
        if (r.status === 200) break;
      }
      status = (await query<{ status: string }>("select status from email_outbox where subject = $1", [marker]))[0].status;
    }
    expect(["SENT", "SKIPPED"]).toContain(status);                                  // sent through the file transport, or parked if this environment has no provider
  });
});
