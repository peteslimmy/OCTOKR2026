import { expect, test, type Page } from "@playwright/test";
import { answerStepUpIfAsked, expectNoA11yViolations, loginAs, query } from "./helpers";

/**
 * Correcting the ledger through the screens: a wrong entry is cancelled by a new entry, never edited. One person asks, a different
 * person approves, a third (or at least not the asker) posts it; a Super Admin has a loud one-step emergency path.
 * The two payments are recorded through the real database operations, as the HR screens would.
 */
const tag = Date.now().toString(36);
let refA = "", refB = "", entryA = "";

async function payment(ref: string, amount: number, vt: string): Promise<string> {
  const hr = (await query<{ id: string }>("select id from users where email = 'hr@4core.local'"))[0].id;
  const emp = (await query<{ id: string }>("select id from employees order by created_at limit 1"))[0].id;
  const v = (await query<{ r: { violation_id: string } }>("select create_violation($1, $2, null, $3, $4, 'e2e fine', null, $5) as r", [hr, emp, vt, amount, `e2e-v-${ref}`]))[0].r;
  const p = (await query<{ r: { ledger_entry_id: string } }>("select record_violation_payment($1, $2, 'PAYMENT', $3, current_date, $4) as r", [hr, v.violation_id, ref, `e2e-p-${ref}`]))[0].r;
  return p.ledger_entry_id;
}

test.beforeAll(async () => {
  const hr = (await query<{ id: string }>("select id from users where email = 'hr@4core.local'"))[0].id;
  const vt = (await query<{ id: string }>("select create_violation_type($1, $2, 'E2E fine', 'LOW', 5000) as id", [hr, `E2E${tag}`.slice(0, 20).toUpperCase()]))[0].id;
  entryA = await payment(`E2E-A-${tag}`, 5000, vt);
  const entryB = await payment(`E2E-B-${tag}`, 2500, vt);
  const ref = async (id: string) => (await query<{ reference: string }>("select reference from financial_ledger_entries where id = $1", [id]))[0].reference;
  refA = await ref(entryA); refB = await ref(entryB);
});

const rowFor = (page: Page, ref: string) => page.getByRole("table", { name: "Violation fund ledger" }).locator("tr").filter({ hasText: ref.slice(0, 18) });
const balance = async () => Number((await query<{ b: string }>("select fund_balance((select id from violation_funds limit 1)) b"))[0].b);

test.describe.serial("ledger reversal", () => {
  test("only finance-side roles reach the ledger, and only the right ones see the controls, and the ledger page is accessible", async ({ page }) => {
    await loginAs(page, "hr@4core.local");
    await page.goto("/violations?tab=fund&view=ledger");
    await expect(page.getByRole("link", { name: "Ledger", exact: true })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Violation fund ledger" })).toHaveCount(0);
    await loginAs(page, "exec@4core.local");
    await page.goto("/violations?tab=fund&view=ledger");
    await expect(page.getByRole("table", { name: "Violation fund ledger" })).toHaveCount(0);
    await loginAs(page, "admin@4core.local");
    await page.goto("/violations?tab=fund&view=ledger");
    await expect(rowFor(page, refA).getByRole("button", { name: /Request reversal/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Emergency reversal/ })).toHaveCount(0);        // Super Admin only
    await expectNoA11yViolations(page, "ledger with reversal controls");
  });

  test("request, approve and post: three steps by different people, original untouched", async ({ page }) => {
    const start = await balance();
    // 1. an Admin asks
    await loginAs(page, "admin@4core.local");
    await page.goto("/violations?tab=fund&view=ledger");
    await rowFor(page, refA).getByRole("button", { name: /Request reversal/ }).click();
    await page.getByRole("dialog").getByLabel("Reason (required)").fill("Recorded against the wrong person");
    await page.getByRole("dialog").getByRole("button", { name: "Send request" }).click();
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(page.getByText("Reversal requested. A different person must approve it.")).toBeVisible();
    await expect(rowFor(page, refA)).toContainText("Reversal in progress");
    expect(await balance()).toBe(start);
    const item = page.getByRole("list", { name: "Ledger reversal requests" }).getByRole("listitem").first();
    await expect(item).toContainText("Waiting for approval");
    await expect(item.getByRole("button")).toHaveCount(0);                                         // an Admin cannot approve

    // 2. Finance approves
    await loginAs(page, "finance@4core.local");
    await page.goto("/violations?tab=fund&view=ledger");
    await page.getByRole("button", { name: /^Approve/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
    await answerStepUpIfAsked(page, "finance@4core.local");
    await expect(page.getByText("Approved. It now waits to be posted.")).toBeVisible();
    expect(await balance()).toBe(start);

    // 3. a Super Admin posts it
    await loginAs(page, "superadmin@4core.local");
    await page.goto("/violations?tab=fund&view=ledger");
    await page.getByRole("button", { name: /^Post reversal/ }).first().click();
    await answerStepUpIfAsked(page, "superadmin@4core.local");
    await expect(page.getByText("Reversal posted to the ledger.")).toBeVisible();
    expect(await balance()).toBe(start - 5000);
    await expect(rowFor(page, refA)).toContainText("Reversed");
    await expect(page.getByRole("table", { name: "Violation fund ledger" })).toContainText("Reverses an earlier entry");
    const original = await query<{ amount: string; entry_type: string }>("select amount, entry_type from financial_ledger_entries where id = $1", [entryA]);
    expect(original[0]).toEqual({ amount: "5000.00", entry_type: "CREDIT" });
    await expectNoA11yViolations(page, "ledger after a posted reversal");
  });

  test("the requester sees that someone else must decide, and a rejection needs a reason", async ({ page }) => {
    await loginAs(page, "finance@4core.local");
    await page.goto("/violations?tab=fund&view=ledger");
    await rowFor(page, refB).getByRole("button", { name: /Request reversal/ }).click();
    await page.getByRole("dialog").getByLabel("Reason (required)").fill("Duplicate entry");
    await page.getByRole("dialog").getByRole("button", { name: "Send request" }).click();
    await answerStepUpIfAsked(page, "finance@4core.local");
    await expect(page.getByText("Reversal requested. A different person must approve it.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Ledger reversal requests" })).toContainText("You made this request, so someone else must decide it.");
    await loginAs(page, "superadmin@4core.local");
    await page.goto("/violations?tab=fund&view=ledger");
    await page.getByRole("button", { name: /^Reject/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Reject request" })).toBeDisabled();
    await dialog.getByLabel(/Reason for rejecting/).fill("The entry is correct");
    await dialog.getByRole("button", { name: "Reject request" }).click();
    await answerStepUpIfAsked(page, "superadmin@4core.local");
    await expect(page.getByText("Request rejected.")).toBeVisible();
    await expect(rowFor(page, refB)).toContainText(/Request reversal/);                              // free to be asked again
  });

  test("a Super Admin can reverse in one step in an emergency, with a full reason, and finance is alerted", async ({ page }) => {
    const start = await balance();
    await loginAs(page, "superadmin@4core.local");
    await page.goto("/violations?tab=fund&view=ledger");
    await rowFor(page, refB).getByRole("button", { name: /Emergency reversal/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/without the usual second person/)).toBeVisible();
    await dialog.getByLabel(/Reason \(required, at least 10 characters\)/).fill("short");
    await expect(dialog.getByRole("button", { name: "Post emergency reversal" })).toBeDisabled();
    await dialog.getByLabel(/Reason \(required, at least 10 characters\)/).fill("Payment was recorded against the wrong fund during the audit");
    await dialog.getByRole("button", { name: "Post emergency reversal" }).click();
    await answerStepUpIfAsked(page, "superadmin@4core.local");
    await expect(page.getByText("Emergency reversal posted. Finance and admin users were alerted.")).toBeVisible();
    expect(await balance()).toBe(start - 2500);
    await expect(page.getByRole("list", { name: "Ledger reversal requests" })).toContainText("Emergency");
    const alerts = await query<{ n: number }>("select count(*)::int n from notifications n join users u on u.id = n.user_id where n.event_type = 'LEDGER_REVERSAL_EMERGENCY' and u.email = 'finance@4core.local'");
    expect(alerts[0].n).toBeGreaterThanOrEqual(1);
    await expectNoA11yViolations(page, "ledger after an emergency reversal");
  });

  test("works on a phone without sideways page scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page, "superadmin@4core.local");
    await page.goto("/violations?tab=fund&view=ledger");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

