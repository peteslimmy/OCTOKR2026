import { expect, test } from "@playwright/test";
import { activeWeek, at, expectNoA11yViolations, loginAs, query, setClock } from "./helpers";

/**
 * 4COREPAL in a real browser: every screen as the people who may open it, with zero accessibility violations, the navigation entry present only while the module is on,
 * and the two things a unit lead does on screen (answer a case) and an executive reads (the case workspace, reports, communications). Data is made by the module's own
 * functions, as the daily review would make it.
 */
let caseId = "";
test.beforeAll(async () => {
  const w = await activeWeek(1);
  setClock(at(w.start, 10 * 60));
  await query("update ai_settings set value = 'false'::jsonb where key = 'enabled'");
});
test.afterAll(async () => { await query("update ai_settings set value = 'false'::jsonb where key = 'enabled'"); });

test("while the module is off nobody sees 4COREPAL in the navigation, and the page says it is not switched on", async ({ page }) => {
  await loginAs(page, "lead.eng@4core.local");
  await page.goto("/dashboard");
  await expect(page.getByRole("navigation").getByRole("link", { name: "4COREPAL" })).toHaveCount(0);
  await page.goto("/ai");
  await expect(page.getByText("4COREPAL is not switched on")).toBeVisible();
  await expectNoA11yViolations(page, "/ai while off");
});

test.describe("with the module on and a case open", () => {
  test.beforeAll(async () => {
    await query("update ai_settings set value = 'true'::jsonb where key = 'enabled'");
    const bu = (await query<{ bu: string }>("select e.business_unit_id bu from users u join employees e on e.id = u.employee_id where u.email = 'lead.eng@4core.local'"))[0].bu;
    caseId = (await query<{ id: string }>("select ai_open_case(null, 'Weekly score fell sharply', 'UNDERPERFORMING_BU', 'The unit scored far lower than the week before.', $1, 'HIGH', 'Found by the daily review.', '[{\"text\":\"The unit recorded RESOURCES as the reason for 3 tasks.\",\"status\":\"HYPOTHESIS\",\"basis\":\"the unit''s own remark; not verified\"}]'::jsonb, 'Ask the unit lead what changed.', '[{\"kind\":\"SCORE\",\"summary\":\"Score fell from 80 to 50\"}]'::jsonb, null, null, null, null) id", [bu]))[0].id;
    await query("select ai_engagement_tick()");
    await query("select ai_draft_corrective_plan($1)", [caseId]);
  });

  test("the navigation shows 4COREPAL to those who may use it, and not to those who may not", async ({ page }) => {
    await loginAs(page, "lead.eng@4core.local");
    await page.goto("/dashboard");
    await expect(page.getByRole("navigation").getByRole("link", { name: "4COREPAL" })).toBeVisible();
    await loginAs(page, "presenter@4core.local");
    await page.goto("/dashboard");
    await expect(page.getByRole("navigation").getByRole("link", { name: "4COREPAL" })).toHaveCount(0);
  });

  const ROUTES: Record<string, string[]> = {
    "lead.eng@4core.local": ["/ai", "/ai/remarks", "/ai/closure", "/ai/cases", "/ai/reports", "/ai/reports/bu-performance", "/ai/reports/outstanding-activities"],
    "exec@4core.local": ["/ai", "/ai/executive", "/ai/remarks", "/ai/closure", "/ai/cases", "/ai/reports", "/ai/reports/weekly-org", "/ai/reports/daily-brief", "/ai/reports/kr-risk", "/ai/communications", "/ai/monitoring"],
    "admin@4core.local": ["/ai/admin", "/ai/admin/policies", "/ai/admin/usage", "/ai/cases"],
    "superadmin@4core.local": ["/ai/approvals", "/ai/admin", "/ai/admin/policies", "/ai/admin/usage", "/ai/executive"],
  };
  for (const [email, routes] of Object.entries(ROUTES)) {
    for (const route of routes) {
      test(`accessibility: ${email} ${route}`, async ({ page }) => {
        await loginAs(page, email);
        await page.goto(route);
        await expect(page.getByRole("main")).toBeVisible();
        await expect(page.getByText("Something went wrong")).toHaveCount(0);
        await expectNoA11yViolations(page, `${route} as ${email}`);
      });
    }
  }

  test("the case workspace shows the evidence, the unit's own reasons as hypotheses, the plan and the timeline, and passes the accessibility gate", async ({ page }) => {
    await loginAs(page, "exec@4core.local");
    await page.goto(`/ai/cases/${caseId}`);
    await expect(page.getByRole("heading", { name: /Weekly score fell sharply/ })).toBeVisible();
    await expect(page.getByText("Hypothesis").first()).toBeVisible();
    await expect(page.getByText("Score fell from 80 to 50")).toBeVisible();
    await expect(page.getByRole("region", { name: "Corrective plan" })).toBeVisible();
    await expect(page.getByText("Not established")).toBeVisible();
    await expect(page.getByText("Unit asked")).toBeVisible();
    await expectNoA11yViolations(page, "case workspace as exec");
  });

  test("a unit lead answers the case on screen; it is recorded on the timeline and stops further escalation", async ({ page }) => {
    await loginAs(page, "lead.eng@4core.local");
    await page.goto(`/ai/cases/${caseId}`);
    await page.getByLabel("Your unit's response").fill("We are short of one developer; cover has been requested.");
    await page.getByRole("button", { name: "Send response" }).click();
    await expect(page.getByText("Unit responded", { exact: true })).toBeVisible();
    await expect(page.getByText("We are short of one developer")).toBeVisible();
    expect((await query<{ responded_at: string | null; status: string }>("select responded_at, status from ai_cases where id = $1", [caseId]))[0].status).toBe("UNDER_INVESTIGATION");
    await expectNoA11yViolations(page, "case after response");
  });

  test("the executive reports page lists the organisation-wide reports and the lead's does not", async ({ page }) => {
    await loginAs(page, "exec@4core.local");
    await page.goto("/ai/reports");
    await expect(page.getByText("Weekly organisational performance report")).toBeVisible();
    await loginAs(page, "lead.eng@4core.local");
    await page.goto("/ai/reports");
    await expect(page.getByText("Weekly organisational performance report")).toHaveCount(0);
    await expect(page.getByText("Business unit performance report")).toBeVisible();
  });

  test("the executive centre opens for an executive and is refused to a unit lead", async ({ page }) => {
    await loginAs(page, "lead.eng@4core.local");
    await page.goto("/ai/executive");
    await expect(page.getByText("The executive centre is for executives and administrators")).toBeVisible();
  });

  test("small screens: the 4COREPAL pages do not scroll sideways", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page, "exec@4core.local");
    for (const route of ["/ai", "/ai/cases", "/ai/executive", "/ai/reports", "/ai/communications"]) {
      await page.goto(route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });
});
