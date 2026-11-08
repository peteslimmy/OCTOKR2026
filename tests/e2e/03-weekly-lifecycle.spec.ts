import { expect, test, type Page } from "@playwright/test";
import { activeWeek, at, expectNoA11yViolations, loginAs, query, runJobs, setClock, type WeekTimes } from "./helpers";

/**
 * The core OKR journey end to end, with real locks: open → draft and submit → content lock → execute → final lock → score → review.
 * The database clock is frozen at each step, so the test does not depend on the weekday it runs on.
 */
test.describe.serial("weekly reporting lifecycle (Engineering)", () => {
  let week: WeekTimes;
  let reportUrl = "";

  test.beforeAll(async () => {
    week = await activeWeek(1);
    setClock(at(week.start, 10 * 60));
  });

  const markTask = async (page: Page, task: string, status: "Done" | "Not done") => {
    const row = page.locator("li").filter({ hasText: task });
    await row.getByRole("button", { name: /is Undefined/ }).click();                 // the Undefined badge opens the choice
    await row.getByRole("button", { name: status, exact: true }).click();
    await expect(row.getByRole("button", { name: /is Undefined/ })).toHaveCount(0);
  };

  const addGoal = async (page: Page, opts: { stretch?: boolean; title: string; tasks: string[] }) => {
    await page.getByRole("button", { name: "Add goal" }).first().click();
    const dialog = page.getByRole("dialog");
    if (opts.stretch) await dialog.getByLabel("Stretch (no Sub-KR applies)").check();
    else await dialog.getByLabel("Sub-KR", { exact: true }).selectOption({ index: 1 });
    await dialog.getByLabel("Goal", { exact: true }).fill(opts.title);
    await dialog.getByLabel("Task 1", { exact: true }).fill(opts.tasks[0]);
    for (let i = 1; i < opts.tasks.length; i++) {
      await dialog.getByRole("button", { name: "Add another task" }).click();
      await dialog.getByLabel(`Task ${i + 1}`, { exact: true }).fill(opts.tasks[i]);
    }
    await expect(dialog.getByText(/SMART/i).first()).toBeVisible();   // live guidance is shown, never blocking
    await dialog.getByRole("button", { name: "Save goal" }).click();
    await expect(page.getByText("Goal added.")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(opts.title)).toBeVisible();   // the refreshed report (new version) is on screen before the next edit
  };

  test("the BU Lead drafts two goals and submits the report", async ({ page }) => {
    await loginAs(page, "lead.eng@4core.local");
    await page.goto("/weekly");
    const start = page.getByRole("button", { name: "Start report" }).first();
    if (await start.isVisible().catch(() => false)) await start.click();
    else await page.getByRole("link", { name: "Open report" }).first().click();
    await expect(page).toHaveURL(/\/weekly\/[0-9a-f-]+/);
    reportUrl = new URL(page.url()).pathname;
    await expect(page.getByText("Open for editing")).toBeVisible();

    await addGoal(page, { title: "Publish three pricing sheets to every sales lead by Friday 17:00", tasks: ["Draft the first sheet", "Review all sheets with sales"] });
    await addGoal(page, { stretch: true, title: "Run one customer interview and share notes by Thursday", tasks: ["Interview one customer"] });
    await expectNoA11yViolations(page, "report editor with goals");

    // a goal cannot be submitted without tasks, but this report is complete: submit
    await page.getByRole("button", { name: "Submit report" }).click();
    await expect(page.getByText("Report submitted.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Submitted/ })).toBeVisible();
  });

  test("after content lock the definitions are frozen and tasks can be executed", async ({ page }) => {
    setClock(at(week.contentLock, 1));
    await loginAs(page, "lead.eng@4core.local");
    await page.goto(reportUrl);
    await expect(page.getByText("Content locked").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Add goal" })).toHaveCount(0);

    // goal 1: both tasks done; goal 2: its task not done (each row's buttons disappear once the new status has been saved and shown)
    await markTask(page, "Draft the first sheet", "Done");
    await markTask(page, "Review all sheets with sales", "Done");
    await markTask(page, "Interview one customer", "Not done");
    await page.reload();
    await expect(page.getByText("1 / 2").first()).toBeVisible();      // one of two goals done
    await expectNoA11yViolations(page, "report editor after content lock");
  });

  test("at final lock the week is scored, immutable and awaiting review", async ({ page }) => {
    setClock(at(week.finalLock, 1));
    await runJobs();
    await loginAs(page, "lead.eng@4core.local");
    await page.goto(reportUrl);
    await expect(page.getByText("Report Finalized")).toBeVisible();
    await expect(page.getByText("50.0%").first()).toBeVisible();     // equal-weight goals: 1 of 2
    await expect(page.getByText("Awaiting review")).toBeVisible();
    await expect(page.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);

    const rows = await query<{ final_score: string; score_state: string }>(
      "select s.final_score, s.score_state from weekly_score_snapshots s join business_units b on b.id = s.business_unit_id where b.name = 'Engineering' and s.reporting_week_id = $1", [week.id]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].final_score)).toBe(50);
    expect(rows[0].score_state).toBe("SCORED");
  });

  test("a Presenter reviews the finalised report; the Executive sees the ranking", async ({ page }) => {
    await loginAs(page, "presenter@4core.local");
    await page.goto(reportUrl);
    await page.getByRole("button", { name: "Review", exact: true }).click();   // the button's tooltip reads "Mark this finalised report as reviewed"
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Report reviewed.")).toBeVisible();
    await expect(page.getByText("Reviewed", { exact: true })).toBeVisible();

    await loginAs(page, "exec@4core.local");
    // the unit filter is a dropdown whose hidden <option>s also say "Engineering": look only at what a person can see
    await expect(page.getByText("Engineering").filter({ visible: true }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoA11yViolations(page, "executive dashboard with data");
  });
});
