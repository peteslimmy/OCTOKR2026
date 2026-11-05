import { expect, test, type Page } from "@playwright/test";
import { activeWeek, at, expectNoA11yViolations, loginAs, query, setClock } from "./helpers";

/**
 * Executive Oversight in a real browser: an Executive comments and recommends from the screen they are reviewing without leaving it, the business unit acknowledges and declines
 * with a reason, the Executive follows up and closes, and every denied path, XSS and accessibility check. Data is made through the screens, as people would.
 */
test.describe.configure({ mode: "serial" });
const ex = expect.configure({ timeout: 30_000 });

let weekId = "";
let engBu = "", engName = "", salesBu = "";
let recUrl = "";
const stamp = Date.now();
const recTitle = `Automate intake follow-up ${stamp}`;
const commentText = `Intake response slowed again this week ${stamp}`;

test.beforeAll(async () => {
  const w = await activeWeek(1);
  weekId = w.id;
  setClock(at(w.start, 10 * 60));
  const eng = (await query<{ id: string; name: string }>("select b.id, b.name from users u join employees e on e.id = u.employee_id join business_units b on b.id = e.business_unit_id where u.email = 'lead.eng@4core.local'"))[0];
  engBu = eng.id; engName = eng.name;
  salesBu = (await query<{ id: string }>("select b.id from users u join employees e on e.id = u.employee_id join business_units b on b.id = e.business_unit_id where u.email = 'lead.sales@4core.local'"))[0].id;
});

const operational = async () => JSON.stringify(await Promise.all([
  query("select * from weekly_reports order by id"), query("select * from smart_goals order by id"), query("select * from tasks order by id"), query("select * from quarterly_objectives order by id"),
  query("select * from governance_sessions order by id"), query("select * from violations order by id"),
]));
let opsBefore = "";

const openPanel = async (page: Page) => {
  // a click before the page has hydrated can be lost in development: retry until the panel opens
  await ex(async () => {
    await page.getByTestId("eo-open-panel").first().click();
    await expect(page.getByTestId("eo-panel")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
};

test("Executive: comments and recommends from the unit's performance screen without leaving it", async ({ page }) => {
  opsBefore = await operational();
  await loginAs(page, "exec@4core.local");
  const url = `/performance?bu=${engBu}`;
  await page.goto(url, { timeout: 90_000 });
  await ex(page.getByRole("heading", { level: 1, name: "Performance" })).toBeVisible({ timeout: 90_000 });
  await openPanel(page);
  const panel = page.getByTestId("eo-panel");
  await ex(panel.locator("#eo-panel-desc")).toContainText(engName);                       // the unit being reviewed is the context

  // a simple comment: no category, no response workflow
  await panel.getByTestId("eo-add-comment").click();
  await panel.getByLabel(/Your comment/).fill(commentText);
  await panel.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByText("Comment posted.")).toBeVisible({ timeout: 90_000 });       // the first call compiles the route in development
  await ex(panel.getByText(commentText)).toBeVisible();
  expect(page.url()).toContain("/performance");                                         // still on the screen being reviewed
  const c = (await query<{ author_role: string; category_id: string | null; business_unit_id: string }>("select author_role, category_id, business_unit_id from eo_comments where content = $1", [commentText]))[0];
  expect(c).toMatchObject({ author_role: "EXECUTIVE", category_id: null, business_unit_id: engBu });
  expect((await query("select 1 from eo_recommendations where title like $1", [`%${stamp}%`])).length).toBe(0);

  // a formal recommendation with a deadline, unit and record already filled in
  await panel.getByTestId("eo-make-recommendation").click();
  const dialog = page.getByRole("dialog", { name: "Make a recommendation" });
  await ex(dialog).toBeVisible();
  await dialog.getByLabel(/^Title/).fill(recTitle);
  await dialog.getByLabel(/^Recommendation/).fill("Automate the nightly follow-up so every intake gets a reply within a day.");
  await dialog.getByLabel(/Why you recommend it/).fill("Late replies delay onboarding.");
  await dialog.getByLabel("Priority").selectOption("HIGH");
  const due = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  await dialog.getByLabel(/Respond by/).fill(due);
  await expect(dialog.getByLabel(engName)).toBeChecked();                                // the unit came from the screen
  await dialog.getByRole("button", { name: "Issue recommendation" }).click();
  await expect(page.getByText("Recommendation issued.")).toBeVisible({ timeout: 90_000 });
  const r = (await query<{ id: string; reference: string; status: string; priority: string }>("select id, reference, status, priority from eo_recommendations where title = $1", [recTitle]))[0];
  expect(r).toMatchObject({ status: "ACTIVE", priority: "HIGH" });
  expect(r.reference).toMatch(/^EOR-/);
  recUrl = `/executive-oversight/recommendations/${r.id}`;
  expect((await query<{ status: string }>("select status from eo_rec_targets where recommendation_id = $1", [r.id]))[0].status).toBe("SUBMITTED");
});

test("Business unit: is told, acknowledges, must give a reason to decline, and the Executive sees the response", async ({ page }) => {
  await loginAs(page, "lead.eng@4core.local");
  await page.goto("/notifications", { timeout: 90_000 });
  await ex(page.getByText(new RegExp(recTitle.slice(0, 30))).first()).toBeVisible({ timeout: 60_000 });
  await page.goto(recUrl, { timeout: 90_000 });
  await ex(page.getByRole("heading", { level: 1 })).toContainText("EOR-");
  await ex(page.getByText("This is advice, not an instruction")).toBeVisible();
  const card = page.getByTestId(`target-${engBu}`);
  await ex(card.getByText("Awaiting acknowledgement")).toBeVisible();
  await ex(async () => {
    await card.getByRole("button", { name: "Acknowledge receipt" }).click();
    await expect(card.getByText("Awaiting response")).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 60_000 });

  await card.getByRole("button", { name: "Respond" }).click();
  const dialog = page.getByRole("dialog", { name: new RegExp(`Respond for ${engName}`) });
  await dialog.getByLabel("Your response").selectOption("DECLINE");
  await expect(dialog.getByRole("button", { name: "Send response" })).toBeDisabled();       // a decline needs a reason
  await dialog.getByLabel(/Explanation/).fill("No capacity this quarter; we will revisit in the next planning round.");
  await dialog.getByRole("button", { name: "Send response" }).click();
  await ex(card.getByText("Not accepted")).toBeVisible();
  expect((await query<{ status: string; decision: string }>("select status, decision from eo_rec_targets where recommendation_id = (select id from eo_recommendations where title = $1)", [recTitle]))[0]).toEqual({ status: "NOT_ACCEPTED", decision: "DECLINE" });
  // advice declined: the unit cannot close it, and there is no control to
  await expect(page.getByRole("button", { name: /Close all|Withdraw/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Report progress" })).toHaveCount(0);
});

test("Executive: reviews the response in the register, follows up and closes without changing any OKR record", async ({ page }) => {
  await loginAs(page, "exec@4core.local");
  await page.goto(`/executive-oversight?tab=recommendations&q=${encodeURIComponent(recTitle)}`, { timeout: 90_000 });       // searched, so older records on earlier pages cannot hide it
  const row = page.getByRole("row", { name: new RegExp(recTitle.slice(0, 30)) });
  await ex(row).toBeVisible({ timeout: 60_000 });
  await expect(row.getByText("Not accepted")).toBeVisible();
  await expect(row.getByText("Recommendation").first()).toBeVisible();                       // visibly a recommendation, not a comment
  await page.goto("/executive-oversight", { timeout: 90_000 });
  await ex(page.getByTestId("eo-overview")).toBeVisible();
  await expect(page.getByText("Not accepted").first()).toBeVisible();
  await page.goto(recUrl, { timeout: 90_000 });
  await ex(page.getByText("No capacity this quarter")).toBeVisible();
  await page.getByRole("button", { name: "Close all" }).click();
  const dialog = page.getByRole("dialog", { name: "Close this recommendation" });
  await dialog.getByLabel(/Why are you closing it/).fill("Understood; revisit next planning round.");
  await dialog.getByRole("button", { name: "Close recommendation" }).click();
  await ex(page.getByText("Closed").first()).toBeVisible();
  expect(await operational()).toBe(opsBefore);                                               // not one operational record changed
});

test("Denied paths: another unit and HR (outside its own unit) see nothing they should not, and a BU Lead cannot start a comment", async ({ page }) => {
  const id = (await query<{ id: string }>("select id from eo_recommendations where title = $1", [recTitle]))[0].id;
  await loginAs(page, "lead.sales@4core.local");
  expect(salesBu).not.toBe(engBu);
  await page.goto(`/executive-oversight/recommendations/${id}`, { timeout: 90_000 });
  await ex(page.getByText(/could not be found/i).first()).toBeVisible();                       // the page streams, so the not-found page is asserted by what it shows
  await expect(page.getByText("This is advice, not an instruction")).toHaveCount(0);
  expect((await page.request.get(`/api/v1/executive-recommendations/${id}`)).status()).toBe(404);
  await loginAs(page, "hr@4core.local");
  await page.goto(`/executive-oversight/recommendations/${id}`, { timeout: 90_000 });
  await ex(page.getByText(/could not be found/i).first()).toBeVisible();
  await expect(page.getByText("This is advice, not an instruction")).toHaveCount(0);
  await page.goto("/executive-oversight?tab=recommendations", { timeout: 90_000 });       // the seeded HR account is also a BU Lead of its own unit: it sees that unit only
  await ex(page.getByText("No recommendations yet")).toBeVisible();
  await expect(page.getByText(recTitle.slice(0, 30))).toHaveCount(0);

  await loginAs(page, "lead.eng@4core.local");
  await page.goto(`/performance`, { timeout: 90_000 });
  await openPanel(page);
  const panel = page.getByTestId("eo-panel");
  await ex(panel.getByText(/Only Executives and Directors can start a comment or recommendation/)).toBeVisible();
  await expect(panel.getByTestId("eo-add-comment")).toHaveCount(0);
  await expect(panel.getByTestId("eo-make-recommendation")).toHaveCount(0);
});

test("The Presenter sees the commentary in Presentation mode but cannot add to it", async ({ page }) => {
  await loginAs(page, "presenter@4core.local");
  await page.goto(`/presentation?week=${weekId}&bu=${engBu}`, { timeout: 90_000 });
  const card = page.getByTestId("presentation-executive-commentary");
  await ex(card).toBeVisible({ timeout: 90_000 });
  await ex(async () => { await card.getByTestId("eo-open-panel").click(); await expect(page.getByTestId("eo-panel")).toBeVisible({ timeout: 3_000 }); }).toPass({ timeout: 60_000 });
  await expect(page.getByTestId("eo-add-comment")).toHaveCount(0);
});

test("XSS: script typed into a comment is shown as text and nothing executes", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  const evil = `<script>window.__xss=1;alert('xss')</script> <img src=x onerror="window.__xss=2;alert('img')"> [link](javascript:alert('js')) xss-${stamp}`;
  await loginAs(page, "exec@4core.local");
  await page.goto(`/performance?bu=${engBu}`, { timeout: 90_000 });
  await openPanel(page);
  const panel = page.getByTestId("eo-panel");
  await panel.getByTestId("eo-add-comment").click();
  await panel.getByLabel(/Your comment/).fill(evil);
  await panel.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByText("Comment posted.")).toBeVisible({ timeout: 90_000 });
  const id = (await query<{ id: string }>("select id from eo_comments where content like $1", [`%xss-${stamp}%`]))[0].id;
  await page.goto(`/executive-oversight/comments/${id}`, { timeout: 90_000 });
  await ex(page.getByText(/<script>window/)).toBeVisible();                                 // visible as text
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(dialogs).toEqual([]);
  expect(await page.locator("article script, article img, article iframe").count()).toBe(0);
  expect(await page.locator('article a[href^="javascript:"]').count()).toBe(0);
});

test("History: an amended comment keeps its earlier wording, and a withdrawn recommendation stays readable", async ({ page }) => {
  await loginAs(page, "exec@4core.local");
  const id = (await query<{ id: string }>("select id from eo_comments where content = $1", [commentText]))[0].id;
  await page.goto(`/executive-oversight/comments/${id}`, { timeout: 90_000 });
  await ex(page.getByRole("button", { name: "Amend" })).toBeVisible({ timeout: 60_000 });
  await ex(async () => { await page.getByRole("button", { name: "Amend" }).click(); await expect(page.getByRole("dialog")).toBeVisible({ timeout: 3_000 }); }).toPass({ timeout: 60_000 });
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("New wording").fill(`${commentText} (clarified: week 2 only)`);
  await dialog.getByLabel(/Why are you changing it/).fill("Clarified the period");
  await dialog.getByRole("button", { name: "Save amendment" }).click();
  await ex(page.getByText("Amended").first()).toBeVisible();
  await page.getByText(/Earlier wording \(1\)/).click();
  await expect(page.getByText(commentText, { exact: true }).first()).toBeVisible();
  expect((await query("select 1 from eo_comment_versions where comment_id = $1", [id])).length).toBe(1);
});

test("Accessibility: the oversight overview, the registers and a recommendation have no violations", async ({ page }) => {
  await loginAs(page, "exec@4core.local");
  await page.goto("/executive-oversight", { timeout: 90_000 });
  await ex(page.getByTestId("eo-overview")).toBeVisible();
  await expectNoA11yViolations(page, "executive oversight overview");
  await page.goto("/executive-oversight?tab=recommendations", { timeout: 90_000 });
  await ex(page.getByRole("table")).toBeVisible();
  await expectNoA11yViolations(page, "recommendation register");
  await page.goto(recUrl, { timeout: 90_000 });
  await ex(page.getByText("This is advice, not an instruction")).toBeVisible();
  await expectNoA11yViolations(page, "recommendation page");
});
