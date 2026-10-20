import { expect, test, type Page } from "@playwright/test";
import { answerStepUpIfAsked, expectNoA11yViolations, loginAs, query } from "./helpers";

/** Strategy in an active quarter is a controlled baseline: asked for, approved by someone else, and the waiting request shows as "still waiting" in notifications. */
let code = "";
let original = "";

async function approveFirst(page: Page, who: string) {
  await loginAs(page, who);
  await page.goto("/strategy");
  const item = page.getByRole("list", { name: "Strategy change requests" }).getByRole("listitem").filter({ hasText: "Waiting for approval" }).first();
  await item.getByRole("button", { name: /^Approve/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve and apply" }).click();
  await answerStepUpIfAsked(page, who);
  await expect(page.getByText("Approved and applied.")).toBeVisible();
}

test.describe.serial("strategy change control", () => {
  test("an Admin asks to retitle a Sub-KR; nothing changes until someone else approves", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/strategy");
    const button = page.getByRole("button", { name: /^Request edit \(Sub-KR/ }).first();
    await button.click();
    const dialog = page.getByRole("dialog");
    code = ((await dialog.getByRole("heading").first().textContent()) ?? "").replace(/^.*Sub-KR\s+/, "").trim();
    expect(code).toMatch(/^KR\d\.\d+$/);
    original = (await query<{ title: string }>("select title from sub_key_results where code = $1 and key_result_id in (select k.id from key_results k join quarterly_objectives o on o.id = k.objective_id join quarters q on q.id = o.quarter_id where q.status = 'ACTIVE')", [code]))[0].title;
    await dialog.getByLabel("Title").fill(`${original} (revised)`);
    await dialog.getByLabel("Why is this change needed? (audited)").fill("Clearer wording agreed in the planning meeting");
    await expectNoA11yViolations(page, "strategy change request dialog");
    await dialog.getByRole("button", { name: "Send request" }).click();
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(page.getByText("Change requested. A different person must approve it.")).toBeVisible();
    const still = (await query<{ title: string }>("select title from sub_key_results where code = $1 and key_result_id in (select k.id from key_results k join quarterly_objectives o on o.id = k.objective_id join quarters q on q.id = o.quarter_id where q.status = 'ACTIVE')", [code]))[0].title;
    expect(still).toBe(original);                                                          // asking changes nothing
    const waiting = page.getByRole("list", { name: "Strategy change requests" }).getByRole("listitem").filter({ hasText: "Waiting for approval" }).first();
    await expect(waiting).toContainText("You made this request, so someone else must decide it.");
  });

  test("the approver is told, sees it is still waiting, approves it, and the notification then says it was dealt with", async ({ page }) => {
    await loginAs(page, "exec@4core.local");
    await page.goto("/notifications");
    const note = page.getByRole("listitem").filter({ hasText: "A strategy change needs your decision" }).first();
    await expect(note.getByText("Still waiting for action")).toBeVisible();
    await expectNoA11yViolations(page, "notifications with a waiting request");

    await approveFirst(page, "exec@4core.local");
    expect((await query<{ title: string }>("select title from sub_key_results where code = $1 and title like '%(revised)'", [code])).length).toBe(1);
    expect((await query<{ n: number }>("select count(*)::int n from strategy_item_versions v join sub_key_results s on s.id = v.item_id where s.code = $1", [code]))[0].n).toBeGreaterThanOrEqual(2);   // the baseline is kept and the new version added

    await page.goto("/notifications");
    await expect(page.getByRole("listitem").filter({ hasText: "A strategy change needs your decision" }).first().getByText("Already dealt with")).toBeVisible();
  });

  test("the original wording is put back the same way, so later specs see the seeded strategy", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/strategy");
    const row = page.getByRole("button", { name: new RegExp(`^Request edit \\(Sub-KR ${code.replace(".", "\\.")}\\)`) });
    await row.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(original);
    await dialog.getByLabel("Why is this change needed? (audited)").fill("Restoring the original wording");
    await dialog.getByRole("button", { name: "Send request" }).click();
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(page.getByText("Change requested. A different person must approve it.")).toBeVisible();
    await approveFirst(page, "exec@4core.local");
    expect((await query<{ title: string }>("select title from sub_key_results where code = $1 and title = $2", [code, original])).length).toBe(1);
  });
});
