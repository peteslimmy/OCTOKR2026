import { expect, test } from "@playwright/test";
import { activeWeek, at, expectNoA11yViolations, loginAs, query, setClock } from "./helpers";

/**
 * Weekly quote rota (HR chooses the unit, the unit enters the quote and who said it, the Presenter shows it) and the simple Note Taker screen.
 */
test.describe.configure({ mode: "serial" });
const ex = expect.configure({ timeout: 30_000 });

let weekId = "";
let engBu = "";
const quote = `Small steps, taken daily ${Date.now()}`;
const jot = `Agreed to retest the payment flow ${Date.now()}`;

test.beforeAll(async () => {
  const w = await activeWeek(1);
  weekId = w.id;
  setClock(at(w.start, 10 * 60));
  engBu = (await query<{ id: string }>("select b.id from users u join employees e on e.id = u.employee_id join business_units b on b.id = e.business_unit_id where u.email = 'lead.eng@4core.local'"))[0].id;
  await query("update quote_turns set status = 'CANCELLED', cancelled_at = now() where reporting_week_id = $1 and status <> 'CANCELLED'", [weekId]);
  // a person who only takes notes: the Finance seed account is given the Note Taker role for this run and loses it afterwards
  await query("insert into user_roles (user_id, role_id) select u.id, r.id from users u, roles r where u.email = 'finance@4core.local' and r.code = 'NOTE_TAKER' on conflict do nothing");
});

test.afterAll(async () => {
  await query("delete from user_roles where user_id = (select id from users where email = 'finance@4core.local') and role_id = (select id from roles where code = 'NOTE_TAKER')");
});

test("HR chooses the unit for the week; the unit's lead is told", async ({ page }) => {
  await loginAs(page, "hr@4core.local");
  await page.goto("/admin/calendar");
  await ex(page.getByRole("heading", { name: "Weekly quote allocation" })).toBeVisible({ timeout: 90_000 });
  await page.locator(`#qa-${weekId}`).selectOption(engBu);
  await page.locator(`#qa-${weekId}`).locator("xpath=ancestor::form").getByRole("button", { name: /Choose|Change/ }).click();
  await ex.poll(async () => (await query("select 1 from quote_turns where reporting_week_id = $1 and business_unit_id = $2 and status = 'ASSIGNED'", [weekId, engBu])).length).toBe(1);
  await ex.poll(async () => (await query("select 1 from notifications n join users u on u.id = n.user_id where n.event_type = 'QUOTE_TURN_ASSIGNED' and u.email = 'lead.eng@4core.local'")).length).toBeGreaterThan(0);
});

test("the unit's lead enters the quote and picks who in the team said it", async ({ page }) => {
  await loginAs(page, "lead.eng@4core.local");
  await page.goto("/quote");
  await ex(page.getByRole("heading", { level: 1, name: "Weekly quote" })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Enter the quote" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/The quote/).fill(quote);
  await ex(dialog.getByLabel(/Who said it/).locator("option")).not.toHaveCount(1);
  await dialog.getByLabel(/Who said it/).selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "Save quote" }).click();
  await ex(dialog).toBeHidden();
  await ex.poll(async () => (await query("select status from quote_turns where reporting_week_id = $1 and status <> 'CANCELLED'", [weekId]))[0]?.status).toBe("SUBMITTED");
  await ex(page.getByText(quote)).toBeVisible();
  await expectNoA11yViolations(page, "quote page");
});

test("the Presenter sees it in Quote review, shows it on screen, and marks it presented", async ({ page }) => {
  await loginAs(page, "presenter@4core.local");
  await page.goto(`/presentation?week=${weekId}`);
  // the quote is on its own tab, not on top of the business units' reports
  await expect(page.getByTestId("quote-review")).toHaveCount(0);
  await page.getByTestId("presentation-tab-quote").click();
  await ex(page).toHaveURL(/view=quote/);
  const review = page.getByTestId("quote-review");
  await ex(review).toBeVisible({ timeout: 90_000 });
  await ex(review.getByText(quote)).toBeVisible();
  await review.getByRole("button", { name: /Show quote/ }).click();
  // the dialog carries the quote twice (the visible text and a screen-reader description), so check the dialog as a whole
  await ex(page.getByRole("dialog")).toContainText(quote);
  await page.keyboard.press("Escape");
  await review.getByRole("button", { name: "Mark presented" }).click();
  await ex.poll(async () => (await query("select status from quote_turns where reporting_week_id = $1 and status <> 'CANCELLED'", [weekId]))[0]?.status).toBe("PRESENTED");
});

test("a person with the Note Taker role writes the notes on one simple page", async ({ page }) => {
  await loginAs(page, "finance@4core.local");
  await page.goto("/notes");
  await ex(page.getByRole("heading", { level: 1, name: "Take notes" })).toBeVisible({ timeout: 90_000 });
  await page.getByTestId(`take-notes-${weekId}`).click();
  await ex(page).toHaveURL(/\/notes\/[0-9a-f-]{36}/, { timeout: 90_000 });
  await ex(page.getByTestId("note-editor")).toBeVisible();
  // one central page for the whole organisation; the simple page has no title, category or visibility to fill in
  await expect(page.getByLabel("Category")).toHaveCount(0);
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(jot);
  await ex.poll(async () => (await query("select 1 from okr_session_notes where content like $1", [`%${jot}%`])).length, { timeout: 60_000 }).toBe(1);
  await expectNoA11yViolations(page, "take notes page");
});
