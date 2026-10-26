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
      const fin = await c.asUser(finance, () => c.rpc<Record<string, unknown>>("read_my_mfa_status"), "aal1");
      expect(fin).toMatchObject({ required: true, enrolled: false, totp: false, email: false, aal: "aal1" });
      expect(fin.emailVerifiedAt).toBeNull();
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

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

async function newSession(c: Ctx, userId: string): Promise<string> {
  const id = randomUUID();
  await c.q("insert into auth.sessions (id, user_id, created_at, updated_at) values ($1, $2, now(), now())", [id, userId]);
  return id;
}

describe("email codes as a second factor (ADR-052)", () => {
  it("count for the session that verified them, not for the account as a whole", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("ALPHA");
      const hr = await c.user(["HR"], bu, "hr");
      const session = await newSession(c, hr);
      const elsewhere = await newSession(c, hr);

      await c.rpc("mfa_email_begin", hr, session, "ENROL", HASH_A, 600);
      expect((await c.rpc<{ status: string }>("mfa_email_consume", hr, session, "ENROL", HASH_B, 5)).status).toBe("INVALID");
      expect((await c.rpc<{ status: string }>("mfa_email_consume", hr, session, "ENROL", HASH_A, 5)).status).toBe("OK");

      expect((await c.q<{ r: boolean }>("select user_has_email_factor($1) r", [hr]))[0].r).toBe(true);
      expect((await c.q<{ r: boolean }>("select user_has_verified_totp($1) r", [hr]))[0].r).toBe(false);
      expect((await c.q<{ r: boolean }>("select user_has_verified_factor($1) r", [hr]))[0].r).toBe(true);

      const here = await c.asUser(hr, () => c.rpc<Record<string, unknown>>("read_my_mfa_status"), "aal1", { session_id: session });
      expect(here).toMatchObject({ required: false, enrolled: true, totp: false, email: true, aal: "aal2" });
      expect(here.emailVerifiedAt).not.toBeNull();
      expect(await c.asUser(hr, async () => (await c.q<{ ok: boolean }>("select auth_aal_satisfied() ok"))[0].ok, "aal1", { session_id: session })).toBe(true);

      // a password-only session, and a different session of the same person, still fail closed
      expect(await c.asUser(hr, async () => (await c.q<{ ok: boolean }>("select auth_aal_satisfied() ok"))[0].ok, "aal1", { session_id: elsewhere })).toBe(false);
      expect(await c.asUser(hr, async () => (await c.q<{ ok: boolean }>("select auth_has_permission('attendance.record') ok"))[0].ok, "aal1", { session_id: elsewhere })).toBe(false);

      // the verification lasts 12 hours, then the session is back to aal1
      await c.q("update mfa_email_verifications set expires_at = now() - interval '1 second' where session_id = $1", [session]);
      expect(await c.asUser(hr, async () => (await c.q<{ ok: boolean }>("select auth_aal_satisfied() ok"))[0].ok, "aal1", { session_id: session })).toBe(false);
      expect((await c.asUser(hr, () => c.rpc<Record<string, unknown>>("read_my_mfa_status"), "aal1", { session_id: session })).aal).toBe("aal1");
    });
  });

  it("codes are single-use, purpose-bound, time-limited, and stop after too many wrong guesses", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("ALPHA");
      const u = await c.user(["BU_LEAD"], bu, "lead");
      const mine = await newSession(c, u);
      const other = await newSession(c, u);

      await c.expectError("AUTHENTICATION_REQUIRED", () => c.rpc("mfa_email_begin", u, randomUUID(), "LOGIN", HASH_A, 600));
      await c.expectError("VALIDATION_ERROR", () => c.rpc("mfa_email_begin", u, mine, "LOGIN", "not-a-hash", 600));

      await c.rpc("mfa_email_begin", u, mine, "LOGIN", HASH_A, 600);
      // the challenge belongs to a session: another session of the same person cannot use it
      expect((await c.rpc<{ status: string }>("mfa_email_consume", u, other, "LOGIN", HASH_A, 5)).status).toBe("NO_CHALLENGE");
      // nor can it satisfy a different purpose
      expect((await c.rpc<{ status: string }>("mfa_email_consume", u, mine, "STEP_UP", HASH_A, 5)).status).toBe("NO_CHALLENGE");
      expect((await c.rpc<{ status: string }>("mfa_email_consume", u, mine, "LOGIN", HASH_B, 5)).status).toBe("INVALID");
      expect((await c.rpc<{ status: string }>("mfa_email_consume", u, mine, "LOGIN", HASH_A, 5)).status).toBe("OK");
      expect((await c.rpc<{ status: string }>("mfa_email_consume", u, mine, "LOGIN", HASH_A, 5)).status).toBe("NO_CHALLENGE");

      // an expired challenge is retired instead of being guessed at
      await c.rpc("mfa_email_begin", u, mine, "STEP_UP", HASH_A, 600);
      await c.q("update email_otp_challenges set created_at = now() - interval '5 minutes', expires_at = now() - interval '1 minute' where user_id = $1 and purpose = 'STEP_UP'", [u]);
      expect((await c.rpc<{ status: string }>("mfa_email_consume", u, mine, "STEP_UP", HASH_A, 5)).status).toBe("EXPIRED");

      // five wrong guesses lock the account like five wrong passwords
      const victim = await c.user(["BU_LEAD"], bu, "victim");
      const vs = await newSession(c, victim);
      await c.rpc("mfa_email_begin", victim, vs, "LOGIN", HASH_A, 600);
      for (let i = 0; i < 4; i++) {
        expect((await c.rpc<{ status: string }>("mfa_email_consume", victim, vs, "LOGIN", HASH_B, 5)).status).toBe("INVALID");
      }
      expect((await c.rpc<{ status: string }>("mfa_email_consume", victim, vs, "LOGIN", HASH_B, 5)).status).toBe("LOCKED");
      expect(await c.rpc<boolean>("user_is_locked", victim)).toBe(true);

      // a tighter attempt budget reports TOO_MANY without locking the account
      const gentle = await c.user(["BU_LEAD"], bu, "gentle");
      const gs = await newSession(c, gentle);
      await c.rpc("mfa_email_begin", gentle, gs, "LOGIN", HASH_A, 600);
      expect((await c.rpc<{ status: string }>("mfa_email_consume", gentle, gs, "LOGIN", HASH_B, 3)).status).toBe("INVALID");
      expect((await c.rpc<{ status: string }>("mfa_email_consume", gentle, gs, "LOGIN", HASH_B, 3)).status).toBe("INVALID");
      expect((await c.rpc<{ status: string }>("mfa_email_consume", gentle, gs, "LOGIN", HASH_B, 3)).status).toBe("TOO_MANY");
      expect(await c.rpc<boolean>("user_is_locked", gentle)).toBe(false);
    });
  });

  it("cannot be switched off while it is the only second factor a role requires", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("ALPHA");
      const admin = await c.user(["ADMIN"], bu, "admin");
      const hr = await c.user(["HR"], bu, "hr");

      await c.expectError("MFA_NOT_ENROLLED", () => c.rpc("disable_email_mfa", hr));
      await c.q("insert into email_mfa_factors (user_id) values ($1)", [admin]);
      await c.expectError("MFA_REQUIRED_BY_ROLE", () => c.rpc("disable_email_mfa", admin));

      await enrol(c, admin);
      await c.q("insert into mfa_email_verifications (session_id, user_id, expires_at) values ($1, $2, now() + interval '1 hour')", [randomUUID(), admin]);
      await c.rpc("disable_email_mfa", admin);
      expect((await c.q("select 1 from email_mfa_factors where user_id = $1", [admin])).length).toBe(0);
      expect((await c.q("select 1 from mfa_email_verifications where user_id = $1", [admin])).length).toBe(0);
      expect((await c.q<{ method: string }>("select new_values ->> 'method' method from audit_logs where action = 'AUTH_MFA_DISABLED'"))[0].method).toBe("email");

      // an ordinary role may switch email codes off without an authenticator
      await c.q("insert into email_mfa_factors (user_id) values ($1)", [hr]);
      await c.rpc("disable_email_mfa", hr);
      expect((await c.q<{ r: boolean }>("select user_has_email_factor($1) r", [hr]))[0].r).toBe(false);
    });
  });
});
