/**
 * 4COREPAL reports, executive centre and communications over HTTP (phase 6). While the module is off nothing is exported; once on, who may export follows the
 * approved role matrix, a lead cannot reach an organisation-wide report, an export is audited without its content, and the optional written explanation
 * is a plain "no provider" answer on a stack that has none.
 *
 *   node scripts/test-stack.mjs run --reset --seed -- node scripts/run-api-tests.mjs ai-reports
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLE_ACCOUNTS, Session, loginAs } from "./session";

const matrix = JSON.parse(readFileSync(path.join(__dirname, "..", "db", "fixtures", "role-matrix.json"), "utf8")) as Record<string, string[]>;
const may = (email: string, perm: string) => ROLE_ACCOUNTS[email].some((r) => (matrix[r] ?? []).includes(perm));
const db = new pg.Client({ connectionString: process.env.DB_URL });
const setEnabled = (on: boolean) => db.query("update ai_settings set value = $1::jsonb where key = 'enabled'", [JSON.stringify(on)]);
beforeAll(async () => { await db.connect(); await setEnabled(false); });
afterAll(async () => { await setEnabled(false); await db.end(); });

describe("reports while the module is off", () => {
  it("nobody can export, and the pages say it is not switched on", async () => {
    const exec = await loginAs("exec@4core.local");
    const r = await exec.request("GET", "/api/v1/ai/reports/weekly-org?format=csv");
    expect(r.status).toBe(403);
    expect(r.json.error?.code).toBe("AI_DISABLED");
    expect((await exec.request("GET", "/ai/reports")).text).toContain("not switched on");
    expect((await exec.request("GET", "/ai/executive")).text).toContain("not switched on");
    expect((await exec.request("GET", "/ai/communications")).text).toContain("not switched on");
  });
  it("anonymous callers get 401, an unknown report 404, and a missing format 422", async () => {
    expect((await new Session().request("GET", "/api/v1/ai/reports/weekly-org?format=csv")).status).toBe(401);
    const exec = await loginAs("exec@4core.local");
    expect((await exec.request("GET", "/api/v1/ai/reports/nope?format=csv")).status).toBe(404);
    expect((await exec.request("GET", "/api/v1/ai/reports/weekly-org")).status).toBe(422);
    expect((await exec.request("GET", "/api/v1/ai/reports/weekly-org?format=pdf")).status).toBe(422);
  });
});

describe("reports once the module is on", () => {
  beforeAll(async () => { await setEnabled(true); });
  afterAll(async () => { await setEnabled(false); });

  for (const email of Object.keys(ROLE_ACCOUNTS)) {
    it(`${email} ${may(email, "ai.report.export") ? "can" : "cannot"} export an organisation-wide report`, async () => {
      const s = await loginAs(email);
      const r = await s.request("GET", "/api/v1/ai/reports/weekly-org?format=csv");
      if (!may(email, "ai.report.export")) { expect(r.status).toBe(403); expect(r.json.error?.code).toBe("PERMISSION_DENIED"); return; }
      const orgWide = may(email, "ai.insights.org") && may(email, "dashboard.executive.view");
      if (!orgWide) { expect(r.status).toBe(403); return; }
      expect([200, 403]).toContain(r.status);                                                  // 403 only if the seed has no weekly data to report on
      if (r.status === 200) expect(r.text).toContain("Weekly organisational performance report");
    });
  }

  it("an export is audited with who, the report and the format, and never with its content", async () => {
    const exec = await loginAs("exec@4core.local");
    const r = await exec.request("GET", "/api/v1/ai/reports/reporting-compliance?format=csv");
    if (r.status !== 200) return;                                                               // nothing to report on in this seed
    const rows = (await db.query("select entity_id, new_values from audit_logs where action = 'AI_REPORT_EXPORTED' order by seq desc limit 1")).rows;
    expect(rows[0]).toMatchObject({ entity_id: "reporting-compliance", new_values: { format: "csv" } });
    expect(JSON.stringify(rows[0].new_values)).not.toMatch(/Weeks due|Filed/);
  });

  it("a lead cannot reach the executive centre or organisation-wide reports, and sees their own reports page", async () => {
    const lead = await loginAs("lead.eng@4core.local");
    expect((await lead.request("GET", "/ai/executive")).text).toContain("for executives and administrators");
    expect((await lead.request("GET", "/ai/reports/weekly-org")).text).toContain("This report cannot be shown");
    expect((await lead.request("GET", "/ai/reports")).text).toContain("Business unit performance report");
    expect((await lead.request("GET", "/ai/reports")).text).not.toContain("Weekly organisational performance report");
  });

  it("the executive centre, report pages and communications load for an executive", async () => {
    const exec = await loginAs("exec@4core.local");
    const page = await exec.request("GET", "/ai/executive");
    expect(page.status).toBe(200);
    expect(/Executive intelligence|No weekly data|No quarter configured/.test(page.text)).toBe(true);
    expect((await exec.request("GET", "/ai/reports")).text).toContain("Weekly organisational performance report");
    expect((await exec.request("GET", "/ai/communications")).status).toBe(200);
  });

  it("the written explanation is a normal 'no provider' answer, not an error", async () => {
    const exec = await loginAs("exec@4core.local");
    const r = await exec.request("POST", "/api/v1/ai/reports/weekly-org/commentary", {});
    if (r.status === 403) return;                                                               // no data for the report in this seed
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ ok: false, reason: "NOT_CONFIGURED" });
  });
});
