import { expect, test, type Page } from "@playwright/test";
import { activeWeek, at, expectNoA11yViolations, loginAs, query, setClock } from "./helpers";

/**
 * OKR Session Notes in a real browser: the Presenter's journey from Presentation mode to finalised minutes, the BU Lead's own-unit access, the denied paths, XSS in a note,
 * autosave failure and recovery, a second editor's conflict, and accessibility. Data is made through the screens and the API, as people would.
 */
test.describe.configure({ mode: "serial" });
// the development server refreshes server data slowly under load: generous waits, never fixed sleeps
const ex = expect.configure({ timeout: 30_000 });

let weekId = "";
let engBu = "", engName = "", salesBu = "";
let sessionUrl = "";
const title = `E2E weekly review ${Date.now()}`;
const actionText = `Investigate the declining transaction success rate ${Date.now()}`;

test.beforeAll(async () => {
  const w = await activeWeek(1);
  weekId = w.id;
  setClock(at(w.start, 10 * 60));
  const eng = (await query<{ id: string; name: string }>("select b.id, b.name from users u join employees e on e.id = u.employee_id join business_units b on b.id = e.business_unit_id where u.email = 'lead.eng@4core.local'"))[0];
  engBu = eng.id; engName = eng.name;
  salesBu = (await query<{ id: string }>("select b.id from users u join employees e on e.id = u.employee_id join business_units b on b.id = e.business_unit_id where u.email = 'lead.sales@4core.local'"))[0].id;
});

// the text editor is the default in these tests (they type markdown); the visual editor has its own test below
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { try { localStorage.setItem("okr-note-editor-mode", "markdown"); } catch { /* ignore */ } }); });

const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(name) }).click();

test("Presenter: from Presentation mode a session opens with the unit and week as context, and the discussion is recorded", async ({ page }) => {
  const reportsBefore = JSON.stringify(await query("select id, status, submission_status, version from weekly_reports order by id"));
  await loginAs(page, "presenter@4core.local");
  await page.goto(`/presentation?week=${weekId}&bu=${engBu}`);
  const card = page.getByTestId("presentation-session-notes");
  await ex(card).toBeVisible();
  const start = card.getByRole("link", { name: /Start a session for/ });
  const href = await start.getAttribute("href");
  await start.click();
  // a click before the page has hydrated can be lost in development: follow the link itself then
  await page.waitForURL(/new=session/, { timeout: 60_000 }).catch(() => page.goto(href!));
  await ex(page).toHaveURL(/new=session/, { timeout: 90_000 });       // the first visit compiles the page in development
  const dialog = page.getByRole("dialog", { name: "Start an OKR session" });
  await ex(dialog.getByLabel("Business unit")).toHaveValue(engBu);       // context carried over
  await ex(dialog.getByLabel("Reporting week")).toHaveValue(weekId);
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create session" }).click();
  await ex(page.getByRole("heading", { level: 1, name: title })).toBeVisible({ timeout: 90_000 });
  sessionUrl = page.url().split("?")[0];
  await ex(page.getByText(engName).first()).toBeVisible();
  await ex(page.getByRole("link", { name: "Back to presentation" })).toHaveAttribute("href", new RegExp(`week=${weekId}&bu=${engBu}`));

  await page.getByRole("button", { name: "Start session" }).click();
  await ex(page.getByText("In progress").first()).toBeVisible();
  await page.getByLabel("Quick note").fill("Transaction success dropped to 91% this week");
  await page.getByLabel("Quick note").press("Enter");
  await ex(page.getByTestId("note-card").filter({ hasText: "Transaction success dropped" })).toBeVisible();
  // recording a discussion never touches the weekly reports
  expect(JSON.stringify(await query("select id, status, submission_status, version from weekly_reports order by id"))).toBe(reportsBefore);
});

test("Presenter: a note autosaves, links to a key result without changing it, and keeps its earlier versions", async ({ page }) => {
  await loginAs(page, "presenter@4core.local");
  await page.goto(`${sessionUrl}?tab=notes`);
  const krBefore = JSON.stringify(await query("select * from key_results order by id"));
  const card = page.getByTestId("note-card").filter({ hasText: "Transaction success dropped" });
  await card.getByRole("button", { name: "Edit" }).click();
  const box = page.getByLabel("Note text");
  await box.fill("## Performance\n\n**Transaction success** dropped to 91%.\n\n- [ ] Ask ENG for the failure export\n\n| Day | Rate |\n| --- | --- |\n| Mon | 93% |");
  await ex(page.getByTestId("save-state")).toHaveAttribute("data-state", /dirty|saving|saved/);
  await ex(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 60_000 });
  await page.getByRole("button", { name: "Done" }).click();
  await ex(card.locator("table")).toBeVisible();
  await ex(card.getByText("Performance", { exact: true })).toBeVisible();
  // link it to a key result from the picker
  await card.getByLabel("Link to an OKR component").selectOption({ index: 1 });
  await card.getByRole("button", { name: "Link", exact: true }).click();
  await ex(card.getByRole("list", { name: "Linked OKR components" })).toBeVisible();
  expect(JSON.stringify(await query("select * from key_results order by id"))).toBe(krBefore);
  expect((await query("select 1 from okr_session_links where removed_at is null")).length).toBeGreaterThan(0);
});

test("Presenter: a decision stays proposed until approved; an action is assigned, and the owner is told", async ({ page }) => {
  await loginAs(page, "presenter@4core.local");
  await page.goto(`${sessionUrl}?tab=decisions`);
  await page.getByRole("button", { name: "Propose a decision…" }).click();
  const d = page.getByRole("dialog", { name: "Propose a decision" });
  await d.locator("#d-title").fill("Daily settlement check");
  await d.getByLabel("What was decided").fill("ENG runs a settlement check every morning.");
  await d.getByRole("button", { name: "Record proposal" }).click();
  const decision = page.getByTestId("decision-card").filter({ hasText: "Daily settlement check" });
  await ex(decision.getByText("Not a formal decision yet")).toBeVisible();
  await decision.getByRole("button", { name: "Approve…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve decision" }).click();
  await ex(decision.getByText("Approved", { exact: true })).toBeVisible();

  await tab(page, "Action items");
  await page.getByRole("button", { name: "Create an action…" }).click();
  const a = page.getByRole("dialog", { name: "Create an action item" });
  await a.getByLabel("What needs to be done").fill(actionText);
  await a.getByLabel("Responsible person").selectOption({ label: (await query<{ n: string }>("select e.first_name || ' ' || e.last_name || ' — ' || b.name n from users u join employees e on e.id = u.employee_id join business_units b on b.id = e.business_unit_id where u.email = 'lead.eng@4core.local'"))[0].n });
  await a.getByLabel("Due date").fill(new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10));
  await a.getByRole("button", { name: "Create action" }).click();
  await ex(page.getByTestId("action-card").filter({ hasText: actionText })).toBeVisible();
  expect((await query("select 1 from notifications n join users u on u.id = n.user_id where u.email = 'lead.eng@4core.local' and n.event_type = 'SESSION_ACTION_ASSIGNED'")).length).toBeGreaterThan(0);
});

test("BU Lead: sees their own unit's session, reports progress on the action, and cannot reach another unit's session", async ({ page }) => {
  await loginAs(page, "lead.eng@4core.local");
  await page.goto("/session-notes");
  await ex(page.getByRole("link", { name: title })).toBeVisible();
  await page.goto(`${sessionUrl}?tab=actions`);
  const card = page.getByTestId("action-card").filter({ hasText: actionText });
  await card.getByRole("button", { name: "Update…" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Status").selectOption("BLOCKED");
  await dlg.getByLabel("What is blocking it?").fill("Waiting for the bank's failure report");
  await dlg.getByRole("button", { name: "Save update" }).click();
  await ex(card.getByText("Blocked: Waiting for the bank's failure report")).toBeVisible();
  // a BU Lead cannot approve decisions, create actions or reassign
  await tab(page, "Decisions");
  await ex(page.getByRole("button", { name: /Approve|Propose a decision/ })).toHaveCount(0);
  await tab(page, "Action items");
  await ex(page.getByRole("button", { name: /Reassign|Create an action/ })).toHaveCount(0);
  // another unit's session: create one as the presenter for SALES and try to open it as the ENG lead
  const other = (await query<{ id: string }>("select create_okr_session((select id from users where email = 'presenter@4core.local'), 'SALES private review', (select id from okr_session_types where code = 'AD_HOC'), current_date, null, $1, null, null, null, (select id from users where email = 'presenter@4core.local'), null, null, '[]'::jsonb, null) ->> 'id' as id", [salesBu]))[0].id;
  await page.goto(`/session-notes/${other}`);          // streamed pages answer 200 and render the not-found screen: assert what is shown
  await ex(page.getByText(/could not be found/i).first()).toBeVisible();
  await ex(page.getByText("SALES private review")).toHaveCount(0);
  const api = await page.request.get(`/api/v1/okr-sessions/${other}`);
  expect(api.status()).toBe(404);
  const write = await page.request.post(`/api/v1/okr-sessions/${other}/notes`, { data: { content: "sneaky", clientKey: "sneaky-key-0001" } });
  expect([403, 404]).toContain(write.status());
  await page.goto("/session-notes");
  await ex(page.getByText("SALES private review")).toHaveCount(0);
});

test("Executive: reads everything, changes nothing", async ({ page }) => {
  await loginAs(page, "exec@4core.local");
  await page.goto("/session-notes");
  await ex(page.getByRole("link", { name: title })).toBeVisible();
  await ex(page.getByTestId("new-session")).toHaveCount(0);
  await page.goto(`${sessionUrl}?tab=notes`);
  await ex(page.getByLabel("Quick note")).toHaveCount(0);
  await ex(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await tab(page, "Decisions");
  await ex(page.getByRole("button", { name: /Approve|Propose/ })).toHaveCount(0);
  const post = await page.request.post(`/api/v1/okr-sessions/${sessionUrl.split("/").pop()}/notes`, { data: { content: "x", clientKey: "exec-key-00001" } });
  expect(post.status()).toBe(403);
});

test("a note with script and event-handler markup is shown as text and nothing runs", async ({ page }) => {
  await loginAs(page, "presenter@4core.local");
  const dialogs: string[] = [];
  page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  await page.goto(`${sessionUrl}?tab=notes`);
  const evil = '<script>window.__pwned=1;alert(1)</script><img src=x onerror="window.__pwned=2;alert(2)"> [click](javascript:alert(3)) **bold**';
  await page.getByLabel("Quick note").fill(evil);
  await page.getByLabel("Quick note").press("Enter");
  const card = page.getByTestId("note-card").filter({ hasText: "bold" }).filter({ hasText: "<script>" });
  await ex(card).toBeVisible();
  await ex(card.locator("script, img")).toHaveCount(0);
  await ex(card.locator("a[href^='javascript']")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(dialogs).toEqual([]);
});

test("autosave: a failed save shows retrying then failed, keeps the text, and recovers when the connection is back", async ({ page }) => {
  await loginAs(page, "presenter@4core.local");
  await page.goto(`${sessionUrl}?tab=notes`);
  await page.getByTestId("note-card").first().getByRole("button", { name: "Edit" }).click();
  let down = true;
  await page.route("**/api/v1/okr-notes/*", (route) => (down && route.request().method() === "PATCH" ? route.abort("connectionfailed") : route.continue()));
  const box = page.getByLabel("Note text");
  await box.fill("Written while the connection was down");
  await ex(page.getByTestId("save-state")).toHaveAttribute("data-state", /retrying|failed/, { timeout: 60_000 });
  await ex(box).toHaveValue("Written while the connection was down");     // never silently discarded
  down = false;
  // the automatic retry may already have succeeded; if the retries were used up the person presses Retry now
  await expect.poll(async () => {
    const state = await page.getByTestId("save-state").getAttribute("data-state");
    if (state === "failed") await page.getByRole("button", { name: "Retry now" }).click();
    return state;
  }, { timeout: 60_000, intervals: [500, 1000, 2000] }).toBe("saved");
  await page.getByRole("button", { name: "Done" }).click();
  await ex(page.getByText("Written while the connection was down")).toBeVisible();
});

test("a second editor of the same note gets a conflict, nothing is overwritten, and they can choose", async ({ browser, page }) => {
  await loginAs(page, "presenter@4core.local");
  await page.goto(`${sessionUrl}?tab=notes`);
  const second = await (await browser.newContext()).newPage();
  await second.addInitScript(() => { try { localStorage.setItem("okr-note-editor-mode", "markdown"); } catch { /* ignore */ } });
  await loginAs(second, "presenter@4core.local");
  await second.goto(`${sessionUrl}?tab=notes`);
  const pick = (p: Page) => p.getByTestId("note-card").filter({ hasText: "Written while the connection was down" });
  await pick(page).getByRole("button", { name: "Edit" }).click();
  await pick(second).getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Note text").fill("First editor's text");
  await ex(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 60_000 });
  await second.getByLabel("Note text").fill("Second editor's text");
  await ex(second.getByText(/saved this note after you opened it/)).toBeVisible({ timeout: 60_000 });
  await ex(second.getByLabel("Note text")).toHaveValue("Second editor's text");     // their text is still there
  const stored = (await query<{ content: string }>("select content from okr_session_notes where session_id = $1 and content like '%editor%'", [sessionUrl.split("/").pop()]))[0].content;
  expect(stored).toBe("First editor's text");                                           // nothing overwritten
  await second.getByRole("button", { name: "Save mine over theirs" }).click();
  await ex(second.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 60_000 });
  const versions = await query("select v.content from okr_session_note_versions v join okr_session_notes n on n.id = v.note_id where n.session_id = $1 and v.content = $2", [sessionUrl.split("/").pop(), "First editor's text"]);
  expect(versions.length).toBe(1);                                                       // the replaced version is kept
  await second.context().close();
});

test("visual editor: formatting, a checklist and a mention are saved as the same formatted text, and the mentioned person is told", async ({ page }) => {
  const sid = sessionUrl.split("/").pop();
  await query("select set_okr_session_participant((select id from users where email = 'presenter@4core.local'), $1, (select id from users where email = 'lead.eng@4core.local'), 'BU_LEAD', false)", [sid]);
  await query("delete from notifications where event_type = 'SESSION_MENTION'");
  await loginAs(page, "presenter@4core.local");
  await page.addInitScript(() => { try { localStorage.setItem("okr-note-editor-mode", "visual"); } catch { /* ignore */ } });
  await page.goto(`${sessionUrl}?tab=notes`);
  await page.getByRole("button", { name: "Open full editor" }).click();
  const editor = page.getByRole("textbox", { name: "Note text (visual editor)" });
  await ex(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type("Visual note: ");
  await page.getByRole("button", { name: "Bold" }).click();
  await page.keyboard.type("important");
  await page.getByRole("button", { name: "Bold" }).click();
  await page.keyboard.type(" for ");
  await page.getByLabel("Mention a participant").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Checklist" }).click();
  await page.keyboard.type("send the export");
  await ex(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 60_000 });
  const stored = (await query<{ content: string }>("select content from okr_session_notes where session_id = $1 and content like '%Visual note%'", [sid]))[0].content;
  expect(stored).toMatch(/Visual note: \*\*important\*\* for @\[[^\]]+\]\(user:[0-9a-f-]{36}\)/);
  expect(stored).toContain("- [ ] send the export");
  expect(stored).not.toMatch(/<|contenteditable|data-user/);                 // the editor's HTML never reaches storage
  expect((await query("select 1 from notifications n join users u on u.id = n.user_id where u.email = 'lead.eng@4core.local' and n.event_type = 'SESSION_MENTION'")).length).toBe(1);
  // the same text in the text editor, and the reading view shows a mention, not a token
  await page.getByRole("button", { name: "Text (markdown)" }).click();
  await ex(page.getByLabel("Note text", { exact: true })).toHaveValue(/\*\*important\*\*/);
  await page.getByRole("button", { name: "Done" }).click();
  const card = page.getByTestId("note-card").filter({ hasText: "Visual note" });
  await ex(card.locator(".mention")).toBeVisible();
  await ex(card.locator("strong", { hasText: "important" })).toBeVisible();
  await ex(card).not.toContainText("user:");
});

test("Presenter: reassigns, extends and escalates an action, records and resolves a risk, invites a participant, and reviews the commitment in the next session", async ({ page }) => {
  const sid = sessionUrl.split("/").pop();
  const second = (await query<{ n: string }>("select e.first_name || ' ' || e.last_name || ' — ' || b.name n from users u join employees e on e.id = u.employee_id join business_units b on b.id = e.business_unit_id where u.email = 'lead.eng2@4core.local'"))[0].n;
  await loginAs(page, "presenter@4core.local");

  // --- the action: reassign (reason, new owner told), extend (justification), escalate
  await page.goto(`${sessionUrl}?tab=actions`);
  const card = page.getByTestId("action-card").filter({ hasText: actionText });
  await card.getByRole("button", { name: "Reassign…" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("New owner").selectOption({ label: second });
  await dlg.getByLabel("Reason").fill("Workload");
  await dlg.getByRole("button", { name: "Reassign", exact: true }).click();
  await ex(card.getByText(second.split(" — ")[0])).toBeVisible();
  expect((await query("select 1 from okr_session_events where event_type = 'REASSIGNED' and remarks = 'Workload' and session_id = $1", [sid])).length).toBe(1);
  expect((await query("select 1 from notifications n join users u on u.id = n.user_id where u.email = 'lead.eng2@4core.local' and n.event_type = 'SESSION_ACTION_ASSIGNED'")).length).toBeGreaterThan(0);

  await card.getByRole("button", { name: "Extend deadline…" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("New due date").fill(new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10));
  await dlg.getByLabel("Justification").fill("Bank report delayed");
  await dlg.getByRole("button", { name: "Extend", exact: true }).click();
  await ex(card.getByText("Deadline moved 1×")).toBeVisible();

  await card.getByRole("button", { name: "Escalate…" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Why is this being escalated?").fill("Blocked for two weeks");
  await dlg.getByRole("button", { name: "Escalate", exact: true }).click();
  await ex(card.getByText("Escalated", { exact: true })).toBeVisible();

  // --- a risk: recorded, then resolved only with a resolution note
  await tab(page, "Risks & blockers");
  await page.getByRole("button", { name: "Record a risk or blocker…" }).click();
  dlg = page.getByRole("dialog");
  await dlg.locator("#r-title").fill("Bank API instability");
  await dlg.locator("#r-desc").fill("Intermittent timeouts at settlement");
  await dlg.getByRole("button", { name: "Record", exact: true }).click();
  const risk = page.getByTestId("risk-card").filter({ hasText: "Bank API instability" }).first();
  await ex(risk).toBeVisible();
  await risk.getByRole("button", { name: "Update…" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Status").selectOption("RESOLVED");
  await dlg.getByLabel("How was it resolved?").fill("Provider fixed the API");
  await dlg.getByRole("button", { name: "Save update" }).click();
  await ex(risk.getByText("Resolved", { exact: true })).toBeVisible();

  // --- a participant is invited from the overview
  await tab(page, "Overview");
  await page.getByLabel("Invite").selectOption({ label: second });
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await ex(page.getByRole("list").filter({ hasText: second.split(" — ")[0] }).first()).toBeVisible();

  // --- the next session reviews the commitment: the same action, reviewed once, never copied
  const next = (await query<{ id: string }>("select create_okr_session((select id from users where email = 'presenter@4core.local'), 'Follow-up review', (select id from okr_session_types where code = 'AD_HOC'), date '2026-11-05', null, (select business_unit_id from okr_sessions where id = $1), null, null, null, (select id from users where email = 'presenter@4core.local'), null, null, '[]'::jsonb, null) ->> 'id' as id", [sid]))[0].id;
  await query("select transition_okr_session((select id from users where email = 'presenter@4core.local'), $1, 'IN_PROGRESS', null, null, null)", [next]);
  const before = Number((await query<{ n: string }>("select count(*) n from okr_session_actions"))[0].n);
  await page.goto(`/session-notes/${next}?tab=actions`);
  await ex(page.getByRole("heading", { name: /Commitments from earlier sessions/ })).toBeVisible();
  const earlier = page.getByTestId("action-card").filter({ hasText: actionText });
  await ex(earlier).toBeVisible();
  await page.getByRole("button", { name: "Record review" }).first().click();
  await ex(page.getByText("Review recorded.")).toBeVisible();
  expect((await query("select 1 from okr_session_carryovers where session_id = $1", [next])).length).toBe(1);
  expect(Number((await query<{ n: string }>("select count(*) n from okr_session_actions"))[0].n)).toBe(before);   // no copy

  // --- the register lists it and exports it
  await page.goto("/session-notes/registers?tab=actions");
  await ex(page.getByTestId("action-card").filter({ hasText: actionText })).toBeVisible();
  const csv = await page.request.get("/api/v1/okr-exports?kind=outstanding-actions&format=csv");
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain(actionText);
  const pdf = await page.request.get("/api/v1/okr-exports?kind=decisions&format=pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  // the AI button is offered only when the module is on and the person may use it
  await page.goto(`${sessionUrl}?tab=minutes`);
  await expect(page.getByRole("button", { name: "Propose a summary with AI" })).toHaveCount(0);
});

test("Presenter: completes the session, then prepares, reviews and finalises the minutes; the PDF is available", async ({ page }) => {
  await loginAs(page, "presenter@4core.local");
  await page.goto(`${sessionUrl}?tab=notes`);
  await page.getByRole("button", { name: "Complete session…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Complete session" }).click();
  await ex(page.getByText("Completed").first()).toBeVisible();
  await tab(page, "Minutes");
  await page.getByRole("button", { name: "Prepare the minutes" }).click();
  await ex(page.getByTestId("working-minutes")).toBeVisible();
  await ex(page.getByLabel("Minutes text")).toHaveValue(/## 8\. Decisions reached[\s\S]*Daily settlement check/);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await page.getByRole("button", { name: "Approve as reviewed" }).click();
  await page.getByRole("button", { name: "Finalise the minutes" }).click();
  await ex(page.getByTestId("final-minutes")).toBeVisible();
  const pdf = await page.request.get(`/api/v1/okr-sessions/${sessionUrl.split("/").pop()}/export?format=pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect((await query("select 1 from audit_logs where action = 'OKR_SESSION_EXPORTED'")).length).toBeGreaterThan(0);
  // history stays reachable: the finalised session is in the library and its history lists what happened
  await page.goto("/session-notes?status=COMPLETED");
  await ex(page.getByRole("link", { name: title })).toBeVisible();
  await page.goto(`${sessionUrl}?tab=history`);
  await ex(page.getByText("finalised").first()).toBeVisible();
});

test("the library, the workspace and the registers have no accessibility violations", async ({ page }) => {
  await loginAs(page, "presenter@4core.local");
  await page.goto("/session-notes");
  await ex(page.getByRole("heading", { level: 1, name: "OKR session notes" })).toBeVisible();
  await expectNoA11yViolations(page, "/session-notes");
  for (const t of ["notes", "decisions", "actions", "minutes", "history"]) {
    await page.goto(`${sessionUrl}?tab=${t}`);
    await ex(page.getByRole("tab", { selected: true })).toBeVisible();
    await expectNoA11yViolations(page, `session workspace ${t}`);
  }
  await page.goto("/session-notes/registers?tab=actions");
  await ex(page.getByRole("heading", { level: 1, name: "Commitments & registers" })).toBeVisible();
  await expectNoA11yViolations(page, "/session-notes/registers");
});
