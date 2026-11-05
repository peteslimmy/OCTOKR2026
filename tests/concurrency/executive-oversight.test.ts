/**
 * Real concurrency tests for Executive Oversight: separate connections, committed data, no rollback.
 * Run with `npm run test:concurrency` (resets the test database first) or, without a reset, `node scripts/test-stack.mjs run -- vitest run --config vitest.concurrency.config.ts tests/concurrency/executive-oversight.test.ts`.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const clients: Client[] = [];
async function conn(): Promise<Client> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  clients.push(c);
  return c;
}
async function rpc(c: Client, fn: string, ...args: unknown[]) {
  const ph = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await c.query(`select ${fn}(${ph}) as r`, args.map((a) => (a !== null && typeof a === "object" && !Array.isArray(a) ? JSON.stringify(a) : a)))).rows[0].r;
}
const errorOf = async (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message.split(/[\s:]/)[0]);

let admin: Client;
let ids: { org: string; bu: string; exec: string; lead: string; lead2: string };
const tag = Math.random().toString(36).slice(2, 6).toUpperCase();

async function mkUser(roles: string[], name: string, bu: string): Promise<string> {
  const id = randomUUID();
  const email = `${name}-${id.slice(0, 6)}@conc.local`;
  await admin.query("insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', '{}', now(), now())", [id, email]);
  const emp = (await admin.query("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values ($1, $2, $3, 'C', $4) returning id", [ids.org, email, name, bu])).rows[0].id;
  await admin.query("insert into users (id, employee_id, email) values ($1, $2, $3)", [id, emp, email]);
  for (const r of roles) await admin.query("insert into user_roles (user_id, role_id) select $1, id from roles where code = $2", [id, r]);
  return id;
}

beforeAll(async () => {
  admin = await conn();
  const org = (await admin.query("select id from organisations limit 1")).rows[0]?.id ?? (await admin.query("insert into organisations (name, code) values ('Conc', 'CONC') returning id")).rows[0].id;
  const bu = (await admin.query("insert into business_units (organisation_id, code, name) values ($1, $2, 'Oversight concurrency BU') returning id", [org, `EO${tag}`])).rows[0].id;
  ids = { org, bu, exec: "", lead: "", lead2: "" };
  ids.exec = await mkUser(["EXECUTIVE"], "exec", bu);
  ids.lead = await mkUser(["BU_LEAD"], "lead", bu);
  ids.lead2 = await mkUser(["BU_LEAD"], "lead2", bu);
});
afterAll(async () => {
  await admin.query("update business_units set status = 'INACTIVE' where id = $1", [ids.bu]);
  await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
});

const comment = (c: Client, key: string | null = null, content = "Observation") =>
  rpc(c, "create_eo_comment", ids.exec, ids.bu, null, null, content, "SHARED", "BU_PERFORMANCE", "BUSINESS_UNIT", ids.bu, null, null, [], key);
const recommendation = (c: Client, title: string) =>
  rpc(c, "save_eo_recommendation", ids.exec, null, null, title, "Detail", null, "Because", null, null, "NORMAL", null, "BU_PERFORMANCE", null, null, null, null, null, null, true, null, [ids.bu], [], true, null);
const target = async (rec: string) => (await admin.query("select id from eo_rec_targets where recommendation_id = $1", [rec])).rows[0].id as string;

describe("concurrent oversight acts", () => {
  it("keeps every one of ten simultaneous replies, in order, from two people", async () => {
    const c = await comment(admin);
    const pool = await Promise.all(Array.from({ length: 10 }, () => conn()));
    const results = await Promise.all(pool.map((p, i) => errorOf(rpc(p, "reply_eo_comment", i % 2 ? ids.lead : ids.exec, c.id, `Reply ${i}`, null))));
    expect(results.filter(Boolean)).toEqual([]);
    const rows = (await admin.query("select seq from eo_events where comment_id = $1 and event_type = 'REPLY' order by seq", [c.id])).rows;
    expect(rows).toHaveLength(10);
  });

  it("creates one comment when the same request is sent twice at once", async () => {
    const [a, b] = await Promise.all([conn(), conn()]);
    const key = `conc-key-${randomUUID()}`;
    const [r1, r2] = await Promise.all([comment(a, key, "Twin"), comment(b, key, "Twin")]);
    expect(r1.id).toBe(r2.id);
    expect((await admin.query("select 1 from eo_comments where content = 'Twin' and business_unit_id = $1", [ids.bu])).rows).toHaveLength(1);
  });

  it("issues one recommendation when the same request key is sent twice at once", async () => {
    const [a, b] = await Promise.all([conn(), conn()]);
    const title = `Twin rec ${randomUUID().slice(0, 6)}`;
    const send = (c: Client) => rpc(c, "save_eo_recommendation", ids.exec, null, null, title, "Detail", null, "Because", null, null, "NORMAL", null, "BU_PERFORMANCE", null, null, null, null, null, null, true, null, [ids.bu], [], true, `conc-rec-${title}`);
    const [r1, r2] = await Promise.all([send(a), send(b)]);
    expect(r1.id).toBe(r2.id);
    expect((await admin.query("select 1 from eo_recommendations where title = $1", [title])).rows).toHaveLength(1);
  });

  it("lets only one of two conflicting responses win, and leaves a consistent record", async () => {
    const rec = await recommendation(admin, `Race ${randomUUID().slice(0, 6)}`);
    const t = await target(rec.id);
    const [a, b] = await Promise.all([conn(), conn()]);
    const [e1, e2] = await Promise.all([
      errorOf(rpc(a, "respond_eo_target", ids.lead, t, "ACCEPT", "yes", null, null)),
      errorOf(rpc(b, "respond_eo_target", ids.lead2, t, "DECLINE", "no", null, null)),
    ]);
    // the second to arrive sees the first one's answer: a settled recommendation cannot be answered again
    expect([e1, e2].filter(Boolean)).toEqual(["INVALID_STATE_TRANSITION"]);
    const row = (await admin.query("select status, decision, version from eo_rec_targets where id = $1", [t])).rows[0];
    expect(["ACCEPTED_FOR_ACTION", "NOT_ACCEPTED"]).toContain(row.status);
    expect((await admin.query("select 1 from eo_events where target_id = $1 and event_type in ('ACCEPTED','DECLINED')", [t])).rows).toHaveLength(1);
  });

  it("lets only one of two amendments from the same version win", async () => {
    const c = await comment(admin, null, "Original wording");
    const [a, b] = await Promise.all([conn(), conn()]);
    const [e1, e2] = await Promise.all([
      errorOf(rpc(a, "amend_eo_comment", ids.exec, c.id, 1, null, null, "Wording A", "reason A")),
      errorOf(rpc(b, "amend_eo_comment", ids.exec, c.id, 1, null, null, "Wording B", "reason B")),
    ]);
    expect([e1, e2].filter(Boolean)).toEqual(["VERSION_CONFLICT"]);
    expect((await admin.query("select 1 from eo_comment_versions where comment_id = $1", [c.id])).rows).toHaveLength(1);
  });

  it("does not deadlock when a unit responds while the author closes", async () => {
    const rec = await recommendation(admin, `Close race ${randomUUID().slice(0, 6)}`);
    const t = await target(rec.id);
    const [a, b] = await Promise.all([conn(), conn()]);
    const results = await Promise.all([
      errorOf(rpc(a, "respond_eo_target", ids.lead, t, "ACCEPT", "yes", null, null)),
      errorOf(rpc(b, "close_eo_recommendation", ids.exec, rec.id, null, "Closing", null)),
    ]);
    expect(results.every((r) => r === null || r === "INVALID_STATE_TRANSITION" || r === "RECOMMENDATION_CLOSED")).toBe(true);
    const row = (await admin.query("select status from eo_rec_targets where id = $1", [t])).rows[0];
    expect(["CLOSED", "ACCEPTED_FOR_ACTION"]).toContain(row.status);
  });
});
