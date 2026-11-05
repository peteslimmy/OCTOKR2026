import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function world(c: Ctx) {
  const bu = await c.bu("IN");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const sa2 = await c.user(["SUPER_ADMIN"], bu, "sa2");
  const hr = await c.user(["HR"], bu, "hr");
  return { bu, admin, sa, sa2, hr };
}
let seq = 0;
const key = () => `in-key-${Date.now()}-${++seq}`;
const CIPHER = (tag = "a") => `v1.k1k1k1k1.${tag}AAAAAAAAAAAAAAAA.${tag}BBBBBBBBBBBBBBBBBBBBBB.${tag}CCCCCCCC`;
interface Res { request_id: string; status: string; protected?: boolean }
const ask = (c: Ctx, actor: string, target: string, proposed: unknown, reason = "Setting this up") => c.rpc<Res>("request_config_change", actor, "INTEGRATION", target, JSON.stringify(proposed), reason, key());
const decide = (c: Ctx, actor: string, id: string, d = "APPROVE") => c.rpc<Res>("decide_config_change", actor, id, d, d === "REJECT" ? "no" : null, key());

const smtp = (extra: Record<string, unknown> = {}) => ({
  action: "CREATE", kind: "SMTP", name: "Company mail", enabled: true,
  settings: { host: "smtp.example.com", port: 587, security: "STARTTLS", username: "mailer", fromName: "4CORE-OKR", fromAddress: "no-reply@example.com", baseUrl: "https://okr.example.com" },
  secrets: { password: CIPHER("p") }, ...extra,
});
const hook = (extra: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) => ({
  action: "CREATE", kind: "WEBHOOK", name: "Ops channel", enabled: true,
  settings: { url: "https://hooks.example.com/okr", events: ["ROLE_*"], format: "JSON", ...settings }, secrets: { signingSecret: CIPHER("s") }, ...extra,
});
const create = async (c: Ctx, w: Awaited<ReturnType<typeof world>>, proposed: { kind: string; name: string } & Record<string, unknown>, target = `t-${Math.random()}`) => {
  const r = await ask(c, w.admin, target, proposed);
  await decide(c, w.sa, r.request_id);
  return (await c.q<{ id: string }>("select id from integrations where kind = $1 and lower(name) = lower($2)", [proposed.kind, proposed.name]))[0].id;
};

describe("integrations are data, approved, and their secrets stay secret (ADR-076)", () => {
  it("the shipped kinds describe their own fields, and only the right roles hold the permissions", async () => {
    await withTx(async (c) => {
      expect((await c.q<{ code: string; slot: string }>("select code, slot from integration_kinds order by code")).map((r) => `${r.code}:${r.slot}`)).toEqual(["ANTHROPIC:AI", "OPENAI_COMPATIBLE:AI", "SMTP:EMAIL", "WEBHOOK:WEBHOOK"]);
      const who = async (p: string) => (await c.q<{ code: string }>("select r.code from role_permissions rp join roles r on r.id = rp.role_id join permissions x on x.id = rp.permission_id where x.code = $1 order by 1", [p])).map((r) => r.code);
      expect(await who("integrations.view")).toEqual(["ADMIN", "SUPER_ADMIN"]);
      expect(await who("integrations.configure")).toEqual(["ADMIN", "SUPER_ADMIN"]);
      expect(await who("integrations.test")).toEqual(["ADMIN", "SUPER_ADMIN"]);
      expect((await c.q<{ protected: boolean }>("select protected from permissions where code = 'integrations.configure'"))[0].protected).toBe(true);
    });
  });

  it("an Admin asks, only a Super Admin can approve, and nothing exists until then", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const r = await ask(c, w.admin, "SMTP:company mail", smtp());
      expect(r).toMatchObject({ status: "PENDING", protected: true });
      expect((await c.q("select 1 from integrations")).length).toBe(0);
      await c.expectError("PERMISSION_DENIED", () => ask(c, w.hr, "SMTP:x", smtp()));
      // a Super Admin's own request applies at once (see role_management), so the second-person rule is shown with an Admin's request
      const admin2 = await c.user(["ADMIN"], w.bu, "admin2");
      await c.expectError("PERMISSION_DENIED", () => decide(c, admin2, r.request_id));           // protected: a second Admin is not enough
      expect(await decide(c, w.sa, r.request_id)).toMatchObject({ status: "APPLIED" });
      const row = (await c.q<{ kind: string; slot: string; enabled: boolean; version: number }>("select kind, slot, enabled, version from integrations"))[0];
      expect(row).toEqual({ kind: "SMTP", slot: "EMAIL", enabled: true, version: 1 });
    });
  });

  it("is validated against the kind when asked: required fields, ranges, addresses, choices, tags", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const bad = (proposed: unknown) => c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, `t-${Math.random()}`, proposed));
      await bad(smtp({ settings: { port: 587, security: "STARTTLS", fromAddress: "a@b.co", baseUrl: "https://x.example" } }));                                     // no host
      await bad(smtp({ settings: { host: "h.example.com", port: 70000, security: "STARTTLS", fromAddress: "a@b.co", baseUrl: "https://x.example" } }));          // port
      await bad(smtp({ settings: { host: "h.example.com", port: 25, security: "SSL", fromAddress: "a@b.co", baseUrl: "https://x.example" } }));                 // choice
      await bad(smtp({ settings: { host: "h.example.com", port: 25, security: "TLS", fromAddress: "not an address", baseUrl: "https://x.example" } }));         // address
      await bad(smtp({ settings: { host: "h.example.com", port: 25, security: "TLS", fromAddress: "a@b.co", baseUrl: "ftp://x.example" } }));                   // web address
      await bad(smtp({ settings: { host: "h.example.com", port: 25, security: "TLS", fromAddress: "a@b.co", baseUrl: "https://x.example", extra: 1 } }));       // unknown setting
      await bad(hook({}, { events: ["role created"] }));                                                                                                      // tag pattern
      await bad(hook({}, { url: "javascript:alert(1)" }));
      await bad({ ...hook(), kind: "NO_SUCH_KIND" });
      await bad({ ...hook(), action: "RENAME" });
      await bad({ ...hook(), name: " " });
      await bad({ ...hook(), secrets: { apiKey: CIPHER() } });                                                                                                // not a secret of this kind
      await bad({ action: "CREATE", kind: "ANTHROPIC", name: "Claude", enabled: false, settings: { model: "claude-sonnet-5-5" }, secrets: {} });              // the key is required
      expect((await c.q("select 1 from config_change_requests")).length).toBe(0);
    });
  });

  it("a secret that was not encrypted is refused, and no ciphertext or secret is readable by a person", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, "t1", smtp({ secrets: { password: "my-plain-password" } })));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, "t2", smtp({ secrets: { password: "v1.too.short" } })));
      const id = await create(c, w, smtp());
      const view = await c.asUser(w.admin, () => c.rpc<{ items: { id: string; secrets_set: string[]; settings: Record<string, unknown> }[] }>("read_integrations"));
      expect(view.items[0]).toMatchObject({ id, secrets_set: ["password"] });
      expect(JSON.stringify(view)).not.toContain("v1.");                                                                   // not even the ciphertext
      await c.client.query("savepoint s1");
      let denied = false;
      try { await c.asUser(w.admin, async () => c.q("select secrets from integrations")); } catch { denied = true; await c.client.query("rollback to savepoint s1"); }
      expect(denied).toBe(true);                                                                                           // the table itself is closed to browser sessions
      await c.client.query("savepoint s2");
      let hrDenied = false;
      try { await c.asUser(w.hr, () => c.rpc("read_integrations")); } catch { hrDenied = true; await c.client.query("rollback to savepoint s2"); }
      expect(hrDenied).toBe(true);
      // the request and the audit log carry ciphertext at most, and the audit entry says only which secrets changed
      const stored = JSON.stringify((await c.q("select proposed::text from config_change_requests")).map((r) => r));
      expect(stored).not.toContain("my-plain-password");
      const audit = (await c.q<{ new_values: { secrets_set: string[] } }>("select new_values from audit_logs where action = 'INTEGRATION_CREATED'"))[0];
      expect(audit.new_values.secrets_set).toEqual(["password"]);
      expect(JSON.stringify(audit)).not.toContain("v1.");
    });
  });

  it("only one email service and one AI provider are in use at a time; webhooks may be many", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await create(c, w, smtp());
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, "t-second", smtp({ name: "Second mail" })).then((r) => decide(c, w.sa, r.request_id)));
      await create(c, w, smtp({ name: "Backup mail", enabled: false }));                                                  // saved switched off is fine
      await create(c, w, hook());
      await create(c, w, hook({ name: "Another channel" }));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, "t-dup", hook()).then((r) => decide(c, w.sa, r.request_id)));                       // same kind and name
      expect((await c.q("select 1 from integrations where slot = 'WEBHOOK'")).length).toBe(2);
    });
  });

  it("updates replace settings, change secrets one by one, switch on and off, and forget an old test result", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = await create(c, w, smtp());
      await c.rpc("ops_integration_record_test", w.admin, id, true, "Connected");
      const st = (await c.q<{ last_test_ok: boolean }>("select last_test_ok from integrations where id = $1", [id]))[0];
      expect(st.last_test_ok).toBe(true);

      // switching off keeps every setting and secret, and the test result
      let r = await ask(c, w.admin, id, { action: "UPDATE", name: "Company mail", enabled: false, settings: smtp().settings, secrets: {} });
      await decide(c, w.sa, r.request_id);
      let row = (await c.q<{ enabled: boolean; version: number; secrets: Record<string, string>; last_test_ok: boolean | null }>("select enabled, version, secrets, last_test_ok from integrations where id = $1", [id]))[0];
      expect(row).toMatchObject({ enabled: false, version: 2, last_test_ok: true });
      expect(Object.keys(row.secrets)).toEqual(["password"]);

      // a new password replaces the old; the test result is cleared because the connection changed
      r = await ask(c, w.admin, id, { action: "UPDATE", name: "Company mail", enabled: false, settings: smtp().settings, secrets: { password: CIPHER("n") } });
      await decide(c, w.sa, r.request_id);
      row = (await c.q<{ enabled: boolean; version: number; secrets: Record<string, string>; last_test_ok: boolean | null }>("select enabled, version, secrets, last_test_ok from integrations where id = $1", [id]))[0];
      expect(row.secrets.password).toContain("nAAAA");
      expect(row.last_test_ok).toBeNull();

      // an optional secret can be removed; a required one cannot
      r = await ask(c, w.admin, id, { action: "UPDATE", name: "Company mail", enabled: false, settings: smtp().settings, secrets: { password: null } });
      await decide(c, w.sa, r.request_id);
      expect(Object.keys((await c.q<{ secrets: object }>("select secrets from integrations where id = $1", [id]))[0].secrets)).toEqual([]);
      const ai = await create(c, w, { action: "CREATE", kind: "ANTHROPIC", name: "Claude", enabled: false, settings: { model: "claude-sonnet-5-5" }, secrets: { apiKey: CIPHER("k") } });
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, ai, { action: "UPDATE", name: "Claude", enabled: false, settings: { model: "claude-sonnet-5-5" }, secrets: { apiKey: null } }));
      await c.expectError("VALIDATION_ERROR", () => ask(c, w.admin, id, { action: "UPDATE", kind: "WEBHOOK", name: "Company mail", enabled: false, settings: smtp().settings, secrets: {} }));   // the kind never changes
    });
  });

  it("removing an integration removes its waiting events, and the audit trail keeps what happened", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = await create(c, w, hook());
      await c.q("select write_audit(null, 'ROLE_CREATED', 'role', 'x')");
      expect((await c.q("select 1 from webhook_outbox where integration_id = $1", [id])).length).toBe(1);
      const r = await ask(c, w.admin, id, { action: "DELETE" });
      await decide(c, w.sa, r.request_id);
      expect((await c.q("select 1 from integrations")).length).toBe(0);
      expect((await c.q("select 1 from webhook_outbox")).length).toBe(0);
      expect((await c.q("select 1 from audit_logs where action = 'INTEGRATION_DELETED'")).length).toBe(1);
    });
  });

  it("webhooks get the events they asked for and nothing else, and never the values or the reason", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const some = await create(c, w, hook({ name: "Roles only" }, { events: ["ROLE_*"] }));
      const all = await create(c, w, hook({ name: "Everything" }, { events: ["*"] }));
      const exact = await create(c, w, hook({ name: "One event" }, { events: ["VIOLATION_TYPE_CREATED"] }));
      const off = await create(c, w, hook({ name: "Switched off", enabled: false }, { events: ["*"] }));
      await c.q("delete from webhook_outbox");
      await c.q("select write_audit(null, 'ROLE_UPDATED', 'role', 'r1', '{\"secret\":\"old\"}'::jsonb, '{\"secret\":\"new\"}'::jsonb, 'private reason')");
      await c.q("select write_audit(null, 'VIOLATION_TYPE_CREATED', 'violation_type', 'v1')");
      const count = async (id: string) => (await c.q<{ n: number }>("select count(*)::int n from webhook_outbox where integration_id = $1", [id]))[0].n;
      expect(await count(some)).toBe(1);
      expect(await count(all)).toBe(2);
      expect(await count(exact)).toBe(1);
      expect(await count(off)).toBe(0);
      const payload = (await c.q<{ payload: Record<string, unknown> }>("select payload from webhook_outbox where integration_id = $1 and event_type = 'ROLE_UPDATED'", [some]))[0].payload;
      expect(payload).toMatchObject({ event: "ROLE_UPDATED", entity_type: "role", entity_id: "r1", outcome: "SUCCESS" });
      expect(JSON.stringify(payload)).not.toMatch(/old|new|private reason|secret/);
    });
  });

  it("the outbox leases, backs off, gives up after five attempts, expires, and skips switched-off integrations", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = await create(c, w, hook({}, { events: ["*"] }));
      await c.q("delete from webhook_outbox");
      await c.q("select write_audit(null, 'ROLE_UPDATED', 'role', 'r1')");
      const claim = () => c.rpc<{ id: string; attempts: number; url: string; signing_secret: string; format: string }[]>("claim_webhook_batch", 10);
      let batch = await claim();
      expect(batch).toHaveLength(1);
      expect(batch[0]).toMatchObject({ attempts: 1, url: "https://hooks.example.com/okr", format: "JSON" });
      expect(batch[0].signing_secret).toContain("v1.");                                      // ciphertext, decrypted only by the web tier
      expect(await claim()).toHaveLength(0);                                                // leased: nobody else gets it
      await c.rpc("mark_webhook_result", batch[0].id, false, "receiver answered 500");
      expect((await c.q<{ status: string; last_error: string }>("select status, last_error from webhook_outbox"))[0]).toEqual({ status: "PENDING", last_error: "receiver answered 500" });
      expect(await claim()).toHaveLength(0);                                                // backed off 2 minutes
      for (let n = 2; n <= 5; n++) {
        await c.q("update webhook_outbox set next_attempt_at = now() - interval '1 second'");
        batch = await claim();
        expect(batch[0].attempts).toBe(n);
        await c.rpc("mark_webhook_result", batch[0].id, false, "still failing");
      }
      expect((await c.q<{ status: string }>("select status from webhook_outbox"))[0].status).toBe("FAILED");     // gave up after the fifth attempt
      expect((await c.rpc<{ webhook_failed: number }>("ops_health")).webhook_failed).toBe(1);

      await c.q("delete from webhook_outbox");
      await c.q("select write_audit(null, 'ROLE_UPDATED', 'role', 'r2')");
      await c.q("update webhook_outbox set expires_at = now() - interval '1 minute'");
      expect(await claim()).toHaveLength(0);
      expect((await c.q<{ status: string }>("select status from webhook_outbox"))[0].status).toBe("SKIPPED");

      await c.q("delete from webhook_outbox");
      await c.q("select write_audit(null, 'ROLE_UPDATED', 'role', 'r3')");
      await c.q("update integrations set enabled = false where id = $1", [id]);
      expect(await claim()).toHaveLength(0);
      expect((await c.q<{ status: string; last_error: string }>("select status, last_error from webhook_outbox"))[0].last_error).toContain("switched off");

      await c.q("delete from webhook_outbox");
      await c.q("update integrations set enabled = true where id = $1", [id]);
      await c.q("select write_audit(null, 'ROLE_UPDATED', 'role', 'r4')");
      batch = await claim();
      await c.rpc("mark_webhook_result", batch[0].id, true);
      expect((await c.q<{ status: string }>("select status from webhook_outbox"))[0].status).toBe("SENT");
    });
  });

  it("the web tier can read what it needs, people cannot, and tests are recorded and audited", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = await create(c, w, smtp());
      const run = await c.rpc<{ id: string; kind: string; settings: { host: string }; secrets: { password: string } } | null>("ops_integration_runtime", "EMAIL");
      expect(run).toMatchObject({ id, kind: "SMTP", settings: { host: "smtp.example.com" } });
      expect(run!.secrets.password).toContain("v1.");
      expect(await c.rpc("ops_integration_runtime", "AI")).toBeNull();
      await c.client.query("savepoint s3");
      let denied = false;
      try { await c.asUser(w.admin, () => c.rpc("ops_integration_runtime", "EMAIL")); } catch { denied = true; await c.client.query("rollback to savepoint s3"); }
      expect(denied).toBe(true);
      await c.expectError("PERMISSION_DENIED", () => c.rpc("ops_integration_record_test", w.hr, id, true, "x"));
      await c.rpc("ops_integration_record_test", w.admin, id, false, "The server rejected the user name or password.");
      expect((await c.q<{ last_test_ok: boolean; last_test_message: string }>("select last_test_ok, last_test_message from integrations"))[0]).toEqual({ last_test_ok: false, last_test_message: "The server rejected the user name or password." });
      expect((await c.q<{ outcome: string }>("select outcome from audit_logs where action = 'INTEGRATION_TESTED'"))[0].outcome).toBe("FAILURE");
    });
  });

  it("a key rotation re-encrypts secrets without a change request, is audited, and still refuses plain text", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = await create(c, w, smtp());
      await c.rpc("ops_integration_rewrap", id, JSON.stringify({ password: CIPHER("z") }), "operator@example.com");
      expect((await c.q<{ secrets: { password: string } }>("select secrets from integrations where id = $1", [id]))[0].secrets.password).toContain("zAAAA");
      expect((await c.q("select 1 from audit_logs where action = 'INTEGRATION_KEY_ROTATED'")).length).toBe(1);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("ops_integration_rewrap", id, JSON.stringify({ password: "plain" }), "operator"));
      expect((await c.rpc<{ id: string }[]>("ops_integration_secrets_all")).map((r) => r.id)).toEqual([id]);
    });
  });

  it("finished webhook rows are purged with the other transient data", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const id = await create(c, w, hook({}, { events: ["*"] }));
      await c.q("delete from webhook_outbox");
      await c.q("insert into webhook_outbox (integration_id, event_type, payload, status, created_at) values ($1, 'A', '{}', 'SENT', now() - interval '200 days'), ($1, 'B', '{}', 'SENT', now() - interval '1 day'), ($1, 'C', '{}', 'PENDING', now() - interval '200 days')", [id]);
      await c.q("update webhook_outbox set expires_at = now() + interval '1 day' where event_type = 'C'");
      await c.rpc("purge_transient_data");
      expect((await c.q<{ event_type: string }>("select event_type from webhook_outbox order by 1")).map((r) => r.event_type)).toEqual(["B", "C"]);
    });
  });
});
