import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { answerStepUpIfAsked, expectNoA11yViolations, loginAs, query } from "./helpers";

/** Integrations are set up in the application, approved by a Super Admin, tested, and then used (ADR-076). */
const SIGNING = "e2e-signing-secret-4321";
const name = `E2E hook ${Date.now().toString(36)}`;
let sink: Server; let sinkUrl = "";
const hits: { body: string; headers: Record<string, string | string[] | undefined> }[] = [];

test.beforeAll(async () => {
  sink = createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { hits.push({ body: b, headers: req.headers }); res.statusCode = 200; res.end("{}"); }); });
  await new Promise<void>((r) => sink.listen(0, "127.0.0.1", r));
  sinkUrl = `http://127.0.0.1:${(sink.address() as AddressInfo).port}/hook`;
});
test.afterAll(() => { sink.close(); });

async function approveFirst(page: Page, who: string, text: string) {
  await loginAs(page, who);
  await page.goto("/admin/approvals");
  const item = page.getByRole("list", { name: "Configuration changes" }).getByRole("listitem").filter({ hasText: "Waiting for approval" }).filter({ hasText: text }).first();
  await item.getByRole("button", { name: /^Approve/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve and apply" }).click();
  await answerStepUpIfAsked(page, who);
  await expect(page.getByText("Approved and applied.")).toBeVisible();
}

test.describe.serial("integrations", () => {
  test("an Admin adds a webhook, tries it before asking, and sends it for approval; nothing is in use until a Super Admin approves", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/integrations");
    await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
    await expectNoA11yViolations(page, "integrations");
    await page.getByRole("button", { name: "Add webhook" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel(/Address that receives the events/).fill(sinkUrl);
    await dialog.getByLabel(/Which events/).fill("ROLE_*");
    await dialog.getByLabel(/Signing secret/).fill(SIGNING);
    await dialog.getByLabel(/Switch it on once approved/).check();
    await dialog.getByLabel("Reason for the approver").fill("Send role changes to the operations channel");
    await expectNoA11yViolations(page, "integration form");

    hits.length = 0;
    await dialog.getByRole("button", { name: "Test these values" }).click();
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(dialog.getByText(/The receiver accepted the test event/)).toBeVisible();
    expect(JSON.parse(hits[0].body).event).toBe("TEST_PING");
    const ts = Number(hits[0].headers["x-okr-timestamp"]);
    expect(hits[0].headers["x-okr-signature"]).toBe(`sha256=${createHmac("sha256", SIGNING).update(`${ts}.${hits[0].body}`).digest("hex")}`);

    await dialog.getByRole("button", { name: "Send for approval" }).click();
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(page.getByText("Sent for approval.")).toBeVisible();
    expect(await query("select 1 from integrations where name = $1", [name])).toHaveLength(0);
    const proposed = (await query<{ p: string }>("select proposed::text p from config_change_requests where topic = 'INTEGRATION' order by created_at desc limit 1"))[0].p;
    expect(proposed).not.toContain(SIGNING);                                                         // only ciphertext was stored
  });

  test("the approver sees what changes without seeing the secret, and approves", async ({ page }) => {
    await loginAs(page, "superadmin@4core.local");
    await page.goto("/admin/approvals");
    const item = page.getByRole("list", { name: "Configuration changes" }).getByRole("listitem").filter({ hasText: "Waiting for approval" }).filter({ hasText: name }).first();
    const table = item.getByRole("table");
    await expect(table).toContainText("Secret: signingSecret");
    await expect(table).toContainText("changed (hidden)");
    await expect(table).not.toContainText("v1.");
    await expect(table).not.toContainText(SIGNING);
    await expectNoA11yViolations(page, "approval of an integration");
    await approveFirst(page, "superadmin@4core.local", name);
    expect(await query("select 1 from integrations where name = $1 and enabled", [name])).toHaveLength(1);
  });

  test("the saved webhook shows as in use with its secret hidden, can be tested, and receives the events it asked for", async ({ page, request }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/integrations");
    const item = page.getByRole("list", { name: "Webhooks integrations" }).getByRole("listitem").filter({ hasText: name });
    await expect(item).toContainText("In use");
    await expect(item).toContainText("Secrets saved: signingSecret (never shown)");
    await expect(item).not.toContainText(SIGNING);
    hits.length = 0;
    await item.getByRole("button", { name: /^Test/ }).click();
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(item.getByRole("status")).toContainText(/accepted the test event/);
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: name })).toContainText(/Last test passed/);

    await query("select write_audit(null, 'ROLE_UPDATED', 'role', $1)", [`e2e-${Date.now()}`]);
    await query("select write_audit(null, 'VIOLATION_TYPE_CREATED', 'violation_type', $1)", [`e2e-${Date.now()}`]);
    hits.length = 0;
    const jobs = await request.post("/api/internal/jobs/run", { headers: { "x-jobs-secret": process.env.JOBS_SECRET! } });
    expect(jobs.status()).toBe(200);
    const events = hits.map((h) => JSON.parse(h.body).event);
    expect(events).toContain("ROLE_UPDATED");
    expect(events).not.toContain("VIOLATION_TYPE_CREATED");
  });

  test("a person without the permission cannot see the page, and a Business Unit Lead gets nothing", async ({ page }) => {
    await loginAs(page, "lead.eng@4core.local");
    await page.goto("/admin/integrations");
    await expect(page.getByText("Integrations are not available for your role")).toBeVisible();
  });

  test("removing it is asked for and approved the same way, which leaves nothing behind", async ({ page }) => {
    await loginAs(page, "admin@4core.local");
    await page.goto("/admin/integrations");
    await page.getByRole("button", { name: new RegExp(`^Remove ${name}`) }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason for the approver").fill("No longer needed");
    await dialog.getByRole("button", { name: "Send for approval" }).click();
    await answerStepUpIfAsked(page, "admin@4core.local");
    await expect(page.getByText("Sent for approval.")).toBeVisible();
    await approveFirst(page, "superadmin@4core.local", name);
    expect(await query("select 1 from integrations where name = $1", [name])).toHaveLength(0);
    expect(await query("select 1 from webhook_outbox")).toHaveLength(0);
  });
});
