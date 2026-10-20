import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTx, type Ctx } from "./helpers";

async function enrol(c: Ctx, userId: string, status: "verified" | "unverified" = "verified") {
  await c.q(
    "insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values ($1, $2, 'test', 'totp', $3, now(), now(), 'x')",
    [randomUUID(), userId, status],
  );
}
const can = (c: Ctx, user: string, aal: "aal1" | "aal2") =>
  c.asUser(user, async () => (await c.q<{ ok: boolean }>("select auth_has_permission('users.manage') ok"))[0].ok, aal);

describe("MFA policy and database enforcement (ADR-052)", () => {
  it("elevated roles need an AAL2 session for permission-based RLS; others are unaffected until they enrol", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("ALPHA");
      const admin = await c.user(["ADMIN"], bu, "admin");
      const finance = await c.user(["FINANCE"], bu, "fin");
      const lead = await c.user(["BU_LEAD"], bu, "lead");
      const hr = await c.user(["HR"], bu, "hr");
      expect((await c.q<{ r: boolean }>("select user_requires_mfa($1) r", [admin]))[0].r).toBe(true);
      expect((await c.q<{ r: boolean }>("select user_requires_mfa($1) r", [finance]))[0].r).toBe(true);
      expect((await c.q<{ r: boolean }>("select user_requires_mfa($1) r", [lead]))[0].r).toBe(false);

      // elevated and not yet enrolled: password-only (aal1) sessions get nothing, even with the right role
      expect(await can(c, admin, "aal1")).toBe(false);
      expect(await can(c, admin, "aal2")).toBe(true);
      // an ordinary role is untouched while it has no factor...
      expect(await c.asUser(hr, async () => (await c.q<{ ok: boolean }>("select auth_has_permission('attendance.record') ok"))[0].ok, "aal1")).toBe(true);
      // ...but once it enrols, a password-only session no longer passes
      await enrol(c, hr);
      expect(await c.asUser(hr, async () => (await c.q<{ ok: boolean }>("select auth_has_permission('attendance.record') ok"))[0].ok, "aal1")).toBe(false);
      expect(await c.asUser(hr, async () => (await c.q<{ ok: boolean }>("select auth_has_permission('attendance.record') ok"))[0].ok, "aal2")).toBe(true);
      // an unverified (abandoned) enrolment does not lock the user out
      await enrol(c, lead, "unverified");
      expect(await c.asUser(lead, async () => (await c.q<{ ok: boolean }>("select auth_has_permission('weekly_report.view_own_bu') ok"))[0].ok, "aal1")).toBe(true);

      // real RLS read: an elevated aal1 session sees no violations / finance rows even though the role allows it
      const fin = await c.asUser(finance, () => c.rpc<{ required: boolean; enrolled: boolean; aal: string }>("read_my_mfa_status"), "aal1");
      expect(fin).toEqual({ required: true, enrolled: false, aal: "aal1" });
      expect(await c.asUser(finance, () => c.q("select * from violations"), "aal1")).toHaveLength(0);
    });
  });

  it("wrong second factors lock the account like wrong passwords", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("ALPHA");
      const u = await c.user(["ADMIN"], bu, "adm");
      for (let i = 0; i < 4; i++) expect(await c.rpc<boolean>("record_mfa_failure", u)).toBe(false);
      expect(await c.rpc<boolean>("user_is_locked", u)).toBe(false);
      expect(await c.rpc<boolean>("record_mfa_failure", u)).toBe(true);
      expect(await c.rpc<boolean>("user_is_locked", u)).toBe(true);
      await c.rpc("record_password_changed", u, "RESET");           // a verified reset clears the lock
      expect(await c.rpc<boolean>("user_is_locked", u)).toBe(false);
      const actions = (await c.q<{ action: string }>("select action from audit_logs where entity_id = $1 order by seq", [u])).map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(["AUTH_MFA_FAILED", "AUTH_ACCOUNT_LOCKED", "AUTH_PASSWORD_RESET"]));
      expect((await c.q("select 1 from notifications where user_id = $1 and event_type = 'PASSWORD_CHANGED'", [u])).length).toBe(1);
      await c.expectError("VALIDATION_ERROR", () => c.rpc("record_password_changed", u, "OTHER"));
    });
  });

  it("administrator MFA reset needs users.manage, a reason, a different target, and a Super Admin for a Super Admin", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("ALPHA");
      const admin = await c.user(["ADMIN"], bu, "admin");
      const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
      const sa2 = await c.user(["SUPER_ADMIN"], bu, "sa2");
      const hr = await c.user(["HR"], bu, "hr");
      const lead = await c.user(["BU_LEAD"], bu, "lead");
      await c.expectError("PERMISSION_DENIED", () => c.rpc("authorise_mfa_reset", lead, hr, "lost phone"));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("authorise_mfa_reset", hr, lead, "lost phone"));
      await c.expectError("REASON_REQUIRED", () => c.rpc("authorise_mfa_reset", admin, hr, " "));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("authorise_mfa_reset", admin, admin, "self"));
      await c.expectError("PERMISSION_DENIED", () => c.rpc("authorise_mfa_reset", admin, sa, "lost phone"));
      await c.rpc("authorise_mfa_reset", sa, sa2, "lost phone");
      const r = await c.rpc<{ requires_mfa: boolean }>("authorise_mfa_reset", admin, hr, "lost phone");
      expect(r.requires_mfa).toBe(false);
      const a = await c.q<{ action: string; reason: string }>("select action, reason from audit_logs where action = 'AUTH_MFA_RESET_BY_ADMIN'");
      expect(a).toHaveLength(2);
      expect(a.every((x) => x.reason === "lost phone")).toBe(true);
    });
  });

  it("password-reset requests are audited without revealing whether the account exists", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("ALPHA");
      const u = await c.user(["BU_LEAD"], bu, "lead");
      const email = (await c.q<{ email: string }>("select email from users where id = $1", [u]))[0].email;
      await c.rpc("record_password_reset_requested", email);
      await c.rpc("record_password_reset_requested", "nobody@nowhere.test");
      const rows = await c.q<{ outcome: string }>("select outcome from audit_logs where action = 'AUTH_PASSWORD_RESET_REQUESTED' order by seq");
      expect(rows.map((r) => r.outcome)).toEqual(["SUCCESS", "DENIED"]);
    });
  });
});
