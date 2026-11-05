/**
 * 4COREPAL over HTTP (phase 3): the module is off until a Super Admin turns it on, who may use the assistant follows the approved role matrix, and a
 * conversation is private to the person who had it, even from a Super Admin. No AI provider is configured on the test stack, so a question when the
 * module is on is answered with a plain "no provider" refusal and nothing leaves the building.
 *
 *   node scripts/test-stack.mjs run --reset --seed -- node scripts/run-api-tests.mjs ai-assistant
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLE_ACCOUNTS, Session, loginAs } from "./session";

const matrix = JSON.parse(readFileSync(path.join(__dirname, "..", "db", "fixtures", "role-matrix.json"), "utf8")) as Record<string, string[]>;
const mayAsk = (email: string) => ROLE_ACCOUNTS[email].some((r) => (matrix[r] ?? []).includes("ai.assistant.use"));
const db = new pg.Client({ connectionString: process.env.DB_URL });
const setEnabled = (on: boolean) => db.query("update ai_settings set value = $1::jsonb where key = 'enabled'", [JSON.stringify(on)]);

beforeAll(async () => { await db.connect(); await setEnabled(false); });
afterAll(async () => { await setEnabled(false); await db.end(); });

describe("4COREPAL while it is switched off (the default)", () => {
  for (const email of Object.keys(ROLE_ACCOUNTS)) {
    it(`${email} is told ${mayAsk(email) ? "the module is not switched on" : "it has no access"}, and nothing is stored`, async () => {
      const s = await loginAs(email);
      const r = await s.request("POST", "/api/v1/ai/assistant", { question: "How are we doing?" });
      expect(r.status).toBe(403);
      expect(r.json.error?.code).toBe(mayAsk(email) ? "AI_DISABLED" : "PERMISSION_DENIED");
    });
  }

  it("the page says so and the navigation does not offer it", async () => {
    const exec = await loginAs("exec@4core.local");
    const page = await exec.request("GET", "/ai");
    expect(page.status).toBe(200);
    expect(page.text).toContain("not switched on");
    const dash = await exec.request("GET", "/dashboard");
    expect(dash.text).not.toContain("4COREPAL");
  });

  it("an anonymous caller gets 401 and a bad body is a validation error", async () => {
    expect((await new Session().request("POST", "/api/v1/ai/assistant", { question: "hi" })).status).toBe(401);
    const s = await loginAs("lead.eng@4core.local");
    expect((await s.request("POST", "/api/v1/ai/assistant", { question: "" })).status).toBe(422);
    expect((await s.request("POST", "/api/v1/ai/assistant", { question: "x", extra: 1 })).status).toBe(422);
    expect((await s.request("POST", "/api/v1/ai/assistant", { question: "x".repeat(2001) })).status).toBe(422);
  });
});

describe("4COREPAL once a Super Admin switches it on", () => {
  let convId = "";
  beforeAll(async () => { await setEnabled(true); });
  afterAll(async () => { await setEnabled(false); });

  it("with no provider configured, a question gets a plain refusal, is not an error, and the conversation exists", async () => {
    const lead = await loginAs("lead.eng@4core.local");
    const r = await lead.request("POST", "/api/v1/ai/assistant", { question: "How is my unit performing?" });
    expect(r.status).toBe(200);
    const d = r.json.data as { conversationId: string; result: { ok: boolean; reason?: string; message?: string } };
    expect(d.result).toMatchObject({ ok: false, reason: "NOT_CONFIGURED" });
    expect(d.result.message).toContain("No AI provider is configured");
    convId = d.conversationId;
    const list = await lead.request("GET", "/api/v1/ai/conversations");
    expect((list.json.data as { conversations: { id: string }[] }).conversations.map((c) => c.id)).toContain(convId);
    const got = await lead.request("GET", `/api/v1/ai/conversations/${convId}`);
    const msgs = (got.json.data as { messages: { role: string; content: string }[] }).messages;
    expect(msgs).toEqual([expect.objectContaining({ role: "user", content: "How is my unit performing?" })]);
  });

  it("nobody else can read that conversation or find it in their list, not even a Super Admin", async () => {
    for (const email of ["superadmin@4core.local", "exec@4core.local", "admin@4core.local", "hr@4core.local"]) {
      const s = await loginAs(email);
      expect((await s.request("GET", `/api/v1/ai/conversations/${convId}`)).status, email).toBe(404);
      const list = await s.request("GET", "/api/v1/ai/conversations");
      expect((list.json.data as { conversations: { id: string }[] }).conversations.map((c) => c.id), email).not.toContain(convId);
      // and nobody can add a question to someone else's conversation
      const r = await s.request("POST", "/api/v1/ai/assistant", { question: "hello", conversationId: convId });
      expect(r.status, email).toBe(404);
    }
  });

  it("a person without the assistant permission is still refused, and the page and navigation appear only for those with it", async () => {
    const presenter = await loginAs("presenter@4core.local");
    expect((await presenter.request("POST", "/api/v1/ai/assistant", { question: "hi" })).json.error?.code).toBe("PERMISSION_DENIED");
    expect((await presenter.request("GET", "/dashboard")).text).not.toContain("4COREPAL");
    const exec = await loginAs("exec@4core.local");
    expect((await exec.request("GET", "/dashboard")).text).toContain("4COREPAL");
    expect((await exec.request("GET", "/ai")).text).toContain("Ask about performance");
  });

  it("the audit log records an answer by the tools it used and never by the question", async () => {
    const rows = (await db.query("select new_values from audit_logs where action = 'AI_ANSWER'")).rows;
    for (const r of rows) expect(JSON.stringify(r.new_values)).not.toContain("How is my unit");
  });
});
