import { expect, test } from "@playwright/test";
import { activeWeek, answerStepUpIfAsked, expectNoA11yViolations, loginAs, query, weekLabel, type WeekTimes } from "./helpers";

/**
 * Controlled score corrections after final lock (runs after 03, so week 2 is finalised): the late-report amendment
 * (authorise → file → submit → review → apply by a different person) and the holiday amendment/reversal.
 */
test.describe.serial("late-report score amendment (Sales)", () => {
  let week: WeekTimes;
  let reportUrl = "";

  test.beforeAll(async () => {
    week = await activeWeek(1);
  });

  test("an Admin authorises Sales to file the missing report", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/governance/late-reports");
    const row = page.getByRole("listitem").filter({ hasText: "Sales" }).filter({ hasText: weekLabel(week) });
    await row.getByRole("button", { name: "Authorise late report" }).click();
    await page.getByRole("dialog").getByLabel("Reason (required)").fill("Sales lost connectivity during the reporting window");
    await page.getByRole("dialog").getByRole("button", { name: "Authorise" }).click();
    await expect(page.getByText("Late report authorised.")).toBeVisible();
    await expect(page.getByText("Authorised — awaiting the BU")).toBeVisible();
    await expectNoA11yViolations(page, "late-report page in progress");
  });

  test("the Sales BU Lead files and submits the late report", async ({ page }) => {
    await loginAs(page, "lead.sales@4core.local");
    await page.goto("/weekly");
    await expect(page.getByText("Authorised late reports")).toBeVisible();
    await page.getByRole("listitem").filter({ hasText: weekLabel(week) }).getByRole("button", { name: "Start report" }).click();   // the late-report row, not the live week
    await expect(page).toHaveURL(/\/weekly\/[0-9a-f-]+/);
    reportUrl = new URL(page.url()).pathname;
    await expect(page.getByText("Late report — authorised exception.")).toBeVisible();

    await page.getByRole("button", { name: "Add goal" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Sub-KR", { exact: true }).selectOption({ index: 1 });
    await dialog.getByLabel("Goal", { exact: true }).fill("Close two open proposals with signed quotes by Friday");
    await dialog.getByLabel("Task 1", { exact: true }).fill("Send the revised quotes");
    await dialog.getByRole("button", { name: "Save goal" }).click();
    await expect(page.getByText("Goal added.")).toBeVisible();

    // submitting before every task has a status is refused with a clear reason
    await page.getByRole("button", { name: "Submit report" }).click();
    await expect(page.getByText("A late report is scored on submission")).toBeVisible();
    const row = page.locator("li").filter({ hasText: "Send the revised quotes" });
    await row.getByRole("button", { name: "Done", exact: true }).click();
    await expect(row.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Submit report" }).click();
    await expect(page.getByText("Report submitted.")).toBeVisible();
  });

  test("a different person reviews; only then can the amendment be applied, and never by the reviewer", async ({ page }) => {
    // the Presenter reviews (no score-amend permission)
    await loginAs(page, "presenter@4core.local");
    await page.goto(reportUrl);
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Report reviewed.")).toBeVisible();

    await loginAs(page, "admin@4core.local");
    await page.goto("/governance/late-reports");
    await page.getByRole("button", { name: "Apply score amendment" }).click();
    await page.getByRole("dialog").getByLabel("Reason (required)").fill("Report verified against the evidence and accepted");
    await page.getByRole("dialog").getByRole("button", { name: "Apply amendment" }).click();
    await expect(page.getByText("Score amended.")).toBeVisible();
    await expect(page.getByText("Weekly score 0.0% → 100.0%")).toBeVisible();
  });

  test("history is preserved: two weekly versions and an amendment version of the quarterly score", async () => {
    const weekly = await query<{ version_number: number; reason: string; final_score: string }>(
      `select s.version_number, s.reason, s.final_score from weekly_score_snapshots s join business_units b on b.id = s.business_unit_id
        where b.name = 'Sales' and s.reporting_week_id = $1 order by s.version_number`, [week.id]);
    expect(weekly.map((r) => [r.version_number, r.reason, Number(r.final_score)])).toEqual([[1, "FINAL_LOCK", 0], [2, "LATE_REPORT_AMENDMENT", 100]]);
    const q = await query<{ source: string }>(
      `select z.source from quarterly_score_snapshots z join business_units b on b.id = z.business_unit_id where b.name = 'Sales' order by z.version_number desc limit 1`);
    expect(q[0].source).toBe("AMENDMENT");
  });
});

test.describe.serial("holiday amendment (Administration)", () => {
  let week: WeekTimes;
  test.beforeAll(async () => {
    week = await activeWeek(0);   // the first week finalised with no reports at all
  });

  test("a closed week needs two Admins: one requests, the other approves or rejects", async ({ page }) => {
    const state = async () => (await query<{ reporting_state: string }>("select reporting_state from reporting_weeks where id = $1", [week.id]))[0].reporting_state;
    const pending = () => page.getByRole("list", { name: "Holiday amendment requests" }).getByRole("listitem").filter({ hasText: weekLabel(week) }).filter({ hasText: "Waiting for a second Admin" });
    const request = async (button: string, reason: string) => {
      await loginAs(page, "admin@4core.local");
      await page.goto("/admin/calendar");
      const row = page.getByRole("listitem").filter({ hasText: weekLabel(week) }).filter({ hasText: /Final locked|Organization holiday/ }).first();
      await row.getByRole("button", { name: button }).click();
      await page.getByRole("dialog").getByLabel("Reason (required, audited)").fill(reason);
      await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
      await answerStepUpIfAsked(page, "admin@4core.local");
      await expect(page.getByText("Request sent. A different Admin must approve it.")).toBeVisible();
    };
    const decide = async (action: "Approve" | "Reject", comment: string | null) => {
      await loginAs(page, "superadmin@4core.local");
      await page.goto("/admin/calendar");
      await pending().getByRole("button", { name: new RegExp(`^${action}`) }).click();
      if (comment) await page.getByRole("dialog").getByLabel(/Reason for rejecting|Comment/).fill(comment);
      await page.getByRole("dialog").getByRole("button", { name: action === "Approve" ? "Approve and apply" : "Reject request" }).click();
      await answerStepUpIfAsked(page, "superadmin@4core.local");
    };

    // 1. declare: nothing changes until the second Admin approves; the requester cannot approve
    await request("Request holiday amendment", "Public holiday declared after the week closed");
    expect(await state()).toBe("NORMAL");
    await expect(pending()).toContainText("You made this request, so another Admin must decide it.");
    await expect(pending().getByRole("button")).toHaveCount(0);
    await decide("Approve", "Confirmed with the MD");
    await expect(page.getByText("Approved and applied; quarterly scores versioned.")).toBeVisible();
    expect(await state()).toBe("ORGANIZATION_HOLIDAY");

    // 2. reverse, rejected: the holiday stays
    await request("Request holiday reversal", "Holiday cancelled");
    await decide("Reject", "The closure stands for every unit");
    await expect(page.getByText("Request rejected.")).toBeVisible();
    expect(await state()).toBe("ORGANIZATION_HOLIDAY");

    // 3. reverse again, approved: the week counts again
    await request("Request holiday reversal", "Holiday cancelled after review");
    await decide("Approve", null);
    await expect(page.getByText("Approved and applied; quarterly scores versioned.")).toBeVisible();
    expect(await state()).toBe("NORMAL");
    const list = page.getByRole("list", { name: "Holiday amendment requests" });
    await expect(list).toContainText("Rejected");
    await expect(list).toContainText("Approved and applied");
    await expectNoA11yViolations(page, "administration with holiday amendment requests");
  });
});
