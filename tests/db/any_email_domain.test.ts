import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { withTx, type Ctx } from "./helpers";

/** A Super Admin may add a person on any address; everyone else needs an approved company domain (ADR-119). */
async function provision(c: Ctx, actor: string, email: string, bu: string) {
  const id = randomUUID();
  await c.q("insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}'::jsonb, '{}'::jsonb, now(), now())", [id, email]);
  return c.q("select provision_user($1, $2, $3, 'Test', 'Person', $4, array['BU_LEAD']::text[])", [actor, id, email, bu]);
}

describe("who may add a person on an unapproved address", () => {
  it("a Super Admin may, with a record only Super Admins can read; an Admin may not", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("DOMBU");
      const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
      const admin = await c.user(["ADMIN"], bu, "admin");
      const email = `person-${Date.now()}@gmail.com`;
      await c.expectError("VALIDATION_ERROR", () => provision(c, admin, email, bu));
      await provision(c, sa, email, bu);
      expect((await c.q("select 1 from users where email = $1", [email])).length).toBe(1);
      const rows = await c.q<{ action: string; actor_user_id: string }>("select action, actor_user_id from audit_logs where action = 'USER_CREATED_UNAPPROVED_DOMAIN'");
      expect(rows.map((r) => r.actor_user_id)).toEqual([sa]);
    });
  });

  it("an approved company domain still works for an Admin, and no extra record is made", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("DOMBU2");
      const admin = await c.user(["ADMIN"], bu, "admin");
      await c.q("insert into allowed_email_domains (domain) values ('company-test.example') on conflict do nothing");
      await provision(c, admin, `p-${Date.now()}@company-test.example`, bu);
      expect((await c.q("select 1 from audit_logs where action = 'USER_CREATED_UNAPPROVED_DOMAIN'")).length).toBe(0);
    });
  });

  it("a public mail provider still cannot be put on the approved list, and the refusal says why", async () => {
    await withTx(async (c) => {
      const bu = await c.bu("DOMBU3");
      const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
      await c.expectError("VALIDATION_ERROR", () => c.rpc("save_allowed_domain", sa, "gmail.com", true));
      const err = await c.q("select 1").then(() => c.rpc("save_allowed_domain", sa, "gmail.com", true)).then(() => null, (e: Error) => e);
      expect(String((err as { detail?: string } | null)?.detail ?? "")).toContain("any address without approving it");
    });
  });
});
