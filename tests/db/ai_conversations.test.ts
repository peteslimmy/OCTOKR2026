import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const bu = await c.bu("AIC");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  const other = await c.user(["BU_LEAD"], bu, "other");
  const hr = await c.user(["HR"], bu, "hr");
  await c.rpc("ai_set_setting", sa, "enabled", true);
  return { bu, sa, lead, other, hr };
}

describe("4COREPAL conversations", () => {
  it("cannot be started while the module is off, or by someone without the permission", async () => {
    await withTx(async (c) => {
      await c.q("update business_units set status = 'INACTIVE'");
      const bu = await c.bu("AID"); const lead = await c.user(["BU_LEAD"], bu, "lead"); const hr = await c.user(["HR"], bu, "hr");
      await c.expectError("AI_DISABLED", () => c.rpc("ai_start_conversation", lead, null));
      const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
      await c.rpc("ai_set_setting", sa, "enabled", true);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ai_start_conversation", hr, null));
      expect(await c.rpc<string>("ai_start_conversation", lead, null)).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it("only the owner can add to a conversation, and only the owner can read it", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const conv = await c.rpc<string>("ai_start_conversation", w.lead, "First question");
      await c.rpc("ai_add_message", w.lead, conv, "user", "How are we doing?");
      await c.expectError("NOT_FOUND", () => c.rpc("ai_add_message", w.other, conv, "user", "I want in"));
      await c.expectError("NOT_FOUND", () => c.rpc("ai_add_message", w.sa, conv, "user", "I want in"));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ai_add_message", w.lead, conv, "system", "x"));
      expect(await c.asUser(w.lead, () => c.q("select id from ai_messages"))).toHaveLength(1);
      expect(await c.asUser(w.other, () => c.q("select id from ai_messages"))).toHaveLength(0);
      expect(await c.asUser(w.sa, () => c.q("select id from ai_conversations"))).toHaveLength(0);
    });
  });

  it("an answer is audited by the tools it used, and the audit holds neither the question nor the answer", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const conv = await c.rpc<string>("ai_start_conversation", w.lead, null);
      await c.rpc("ai_add_message", w.lead, conv, "user", "SECRET QUESTION TEXT");
      await c.rpc("ai_add_message", w.lead, conv, "assistant", "SECRET ANSWER TEXT", [{ tool: "get_bu_performance", ok: true }, { tool: "get_weekly_trend", ok: true }], [{ id: "S1" }], "model-x");
      const audit = await c.q<{ new_values: { tools: string[]; sources: number } }>("select new_values from audit_logs where action = 'AI_ANSWER'");
      expect(audit).toHaveLength(1);
      expect(audit[0].new_values).toEqual({ tools: ["get_bu_performance", "get_weekly_trend"], sources: 1 });
      expect(JSON.stringify(audit)).not.toMatch(/SECRET/);
    });
  });

  it("messages cannot be edited or deleted, and the title is set once from the first question", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const conv = await c.rpc<string>("ai_start_conversation", w.lead, null);
      await c.rpc("ai_title_conversation", w.lead, conv, "First question about the quarter");
      await c.rpc("ai_title_conversation", w.lead, conv, "A later title");
      expect((await c.q<{ title: string }>("select title from ai_conversations where id = $1", [conv]))[0].title).toBe("First question about the quarter");
      await c.rpc("ai_add_message", w.lead, conv, "user", "hello");
      await c.client.query("savepoint m");
      await expect(c.q("update ai_messages set content = 'changed'")).rejects.toThrow();
      await c.client.query("rollback to savepoint m");
    });
  });
});
