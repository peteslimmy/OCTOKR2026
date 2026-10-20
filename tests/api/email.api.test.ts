/**
 * HTTP-level tests for reminders and the email channel (ADR-061): personal preference, administrator settings, and the scheduler run that
 * hands queued mail to the transport. Needs `npm run dev` (or start) with EMAIL_TRANSPORT=file and EMAIL_FILE_DIR=.dev-mail in .env.local,
 * and a seeded database (`npm run dev:seed`).
 */
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { completeMfa } from "./mfa-login";

config({ path: ".env.local" });
const BASE = process.env.API_BASE ?? "http://localhost:3000";
const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const PASSWORD = "DevPassword!2026";
const MAIL_DIR = path.resolve(process.env.EMAIL_FILE_DIR ?? ".dev-mail");

const key = () => randomUUID();

class Session {
  private jar = new Map<string, string>();
  private ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  async request(method: string, path: string, body?: unknown) {
    const res = await fetch(`${BASE}${path}`, {
      method, redirect: "manual",
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), "x-forwarded-for": this.ip, cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (value === "" || /max-age=0/i.test(c)) this.jar.delete(name); else this.jar.set(name, value);
    }
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: payload shapes are asserted at each call site
    let json: { data?: any; error?: { code: string; message: string } } = {};
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json };
  }
}
const sessions = new Map<string, Session>();
async function as(email: string) {
  const cached = sessions.get(email);
  if (cached) return cached;
  const s = new Session();
  const r = await s.request("POST", "/api/v1/auth/login", { email, password: PASSWORD });
  expect(r.status, `login ${email}`).toBe(200);
  await completeMfa(s, email, r);
  sessions.set(email, s);
  return s;
}
const db = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try { return (await c.query(sql, params)).rows as T[]; } finally { await c.end(); }
};
const runJobs = () => fetch(`${BASE}/api/internal/jobs/run`, { method: "POST", headers: { "x-jobs-secret": process.env.JOBS_SECRET ?? "" } });

describe("email preference", () => {
  it("is personal, validated, and defaults to on", async () => {
    expect((await new Session().request("GET", "/api/v1/notification-preferences")).status).toBe(401);
    const s = await as("presenter@4core.local");
    expect((await s.request("PUT", "/api/v1/notification-preferences", { emailEnabled: "yes" })).status).toBe(422);
    expect((await s.request("PUT", "/api/v1/notification-preferences", { emailEnabled: false, userId: randomUUID() })).status).toBe(422);   // no one else's preference
    expect((await s.request("PUT", "/api/v1/notification-preferences", { emailEnabled: false })).json.data).toEqual({ emailEnabled: false });
    expect((await s.request("GET", "/api/v1/notification-preferences")).json.data).toEqual({ emailEnabled: false });
    expect((await s.request("PUT", "/api/v1/notification-preferences", { emailEnabled: true })).status).toBe(200);
    expect((await s.request("GET", "/api/v1/notification-preferences")).json.data).toEqual({ emailEnabled: true });
  });
});

describe("reminder and email settings", () => {
  it("are for administrators only, validated, and saved", async () => {
    expect((await new Session().request("GET", "/api/v1/notification-settings")).status).toBe(401);
    for (const who of ["lead.eng@4core.local", "hr@4core.local", "presenter@4core.local"]) {
      const s = await as(who);
      expect((await s.request("GET", "/api/v1/notification-settings")).status, who).toBe(403);
      expect((await s.request("PUT", "/api/v1/notification-settings", { remindersEnabled: true, reminderHours: [24], maxRemindersPerWeek: 2, emailEnabled: true, reason: "api test" })).status, who).toBe(403);
    }
    const admin = await as("admin@4core.local");
    const before = (await admin.request("GET", "/api/v1/notification-settings")).json.data;
    expect(before.settings).toMatchObject({ reminders_enabled: true });
    expect(before.counts).toBeTypeOf("object");
    const put = (b: unknown) => admin.request("PUT", "/api/v1/notification-settings", b);
    const ok = { remindersEnabled: true, reminderHours: [24, 6], maxRemindersPerWeek: 2, emailEnabled: true, reason: "api test" };
    for (const bad of [{ ...ok, reminderHours: [] }, { ...ok, reminderHours: [0] }, { ...ok, reminderHours: [73] }, { ...ok, reminderHours: [1, 2, 3, 4, 5] }, { ...ok, reminderHours: [24, 24] },
      { ...ok, maxRemindersPerWeek: 0 }, { ...ok, maxRemindersPerWeek: 6 }, { ...ok, remindersEnabled: "yes" }, { ...ok, extra: 1 }, { ...ok, reason: " " }]) {
      expect((await put(bad)).status, JSON.stringify(bad)).toBe(422);
    }
    // saving is a request now: nothing changes until a different person approves (ADR-068)
    const saved = await put({ ...ok, reminderHours: [12, 48], maxRemindersPerWeek: 3 });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    expect(saved.json.data.status).toBe("PENDING");
    expect((await admin.request("GET", "/api/v1/notification-settings")).json.data.settings.reminder_hours).toEqual([24, 6]);
    expect((await put(ok)).status).toBe(409);                                       // one request per setting at a time
    const sa = await as("superadmin@4core.local");
    const approve = (id: string) => sa.request("POST", `/api/v1/config-changes/${id}/decision`, { decision: "APPROVE", idempotencyKey: key() });
    expect((await admin.request("POST", `/api/v1/config-changes/${saved.json.data.request_id}/decision`, { decision: "APPROVE", idempotencyKey: key() })).status).toBe(403);   // not your own request
    expect((await approve(saved.json.data.request_id)).status).toBe(200);
    expect((await admin.request("GET", "/api/v1/notification-settings")).json.data.settings.reminder_hours).toEqual([48, 12]);
    const back = await put(ok);                                                      // put the defaults back, the same way
    expect(back.status).toBe(200);
    expect((await approve(back.json.data.request_id)).status).toBe(200);
  });
});

describe("scheduler run", () => {
  it("needs the shared secret", async () => {
    expect((await fetch(`${BASE}/api/internal/jobs/run`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${BASE}/api/internal/jobs/run`, { method: "POST", headers: { "x-jobs-secret": "wrong-secret-value-1234" } })).status).toBe(401);
  });

  it("hands queued mail to the transport, once, and records the outcome", async () => {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const target = (await db<{ id: string; email: string }>("select id, email::text from users where email = 'exec@4core.local'"))[0];
    const marker = `api-test-${randomUUID().slice(0, 8)}`;
    const before = new Set(await readdir(MAIL_DIR).catch(() => [] as string[]));
    const r = await sb.rpc("notify_users", { p_user_ids: [target.id], p_event: "PASSWORD_CHANGED", p_entity_type: "user", p_entity_id: target.id, p_title: `Your password was changed (${marker})`, p_message: `Test message ${marker}`, p_dedupe: marker });
    expect(r.error).toBeNull();
    expect((await db<{ status: string }>("select status from email_outbox where subject like $1", [`%${marker}%`]))[0].status).toBe("PENDING");

    // The outbox hands over a limited batch per run and works oldest first, so a backlog from earlier activity may come before this mail: run until it has gone.
    let mine: { to: string; subject: string; text: string }[] = [];
    for (let i = 0; i < 12 && mine.length === 0; i++) {
      const res = await runJobs();
      expect(res.status).toBe(200);
      const out = (await res.json()).data;
      expect(out.email).toMatchObject({ transport: "file" });
      const files = (await readdir(MAIL_DIR)).filter((f) => !before.has(f));
      const mails = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(MAIL_DIR, f), "utf8")) as { to: string; subject: string; text: string }));
      mine = mails.filter((m) => m.subject.includes(marker));
    }
    expect(mine).toHaveLength(1);
    expect(mine[0].to).toBe(target.email);
    expect(mine[0].text).toContain(`Test message ${marker}`);
    expect(mine[0].text).toContain("/notifications");
    expect((await db<{ status: string; attempts: number }>("select status, attempts from email_outbox where subject like $1", [`%${marker}%`]))[0]).toEqual({ status: "SENT", attempts: 1 });

    await runJobs();                                                                   // a second run sends nothing again
    const again = (await readdir(MAIL_DIR)).filter((f) => !before.has(f));
    const dup = (await Promise.all(again.map(async (f) => (JSON.parse(await readFile(path.join(MAIL_DIR, f), "utf8")) as { subject: string }).subject))).filter((s) => s.includes(marker));
    expect(dup).toHaveLength(1);
  });

  it("does not email a person who has turned routine email off, but still sends security mail", async () => {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const target = (await db<{ id: string }>("select id from users where email = 'director@4core.local'"))[0];
    await sb.rpc("set_email_preference", { p_actor: target.id, p_enabled: false });
    try {
      const marker = `api-pref-${randomUUID().slice(0, 8)}`;
      await sb.rpc("notify_users", { p_user_ids: [target.id], p_event: "REPORT_DUE_REMINDER", p_entity_type: "user", p_entity_id: target.id, p_title: `Routine ${marker}`, p_message: "routine", p_dedupe: `${marker}-a` });
      await sb.rpc("notify_users", { p_user_ids: [target.id], p_event: "MFA_RESET", p_entity_type: "user", p_entity_id: target.id, p_title: `Security ${marker}`, p_message: "security", p_dedupe: `${marker}-b` });
      const rows = await db<{ subject: string }>("select subject from email_outbox where subject like $1 order by subject", [`%${marker}%`]);
      expect(rows.map((r) => r.subject)).toEqual([`Security ${marker}`]);
      const inApp = await db<{ n: number }>("select count(*)::int n from notifications where user_id = $1 and dedupe_key like $2", [target.id, `${marker}%`]);
      expect(inApp[0].n).toBe(2);                                                       // both are still in the application
    } finally { await sb.rpc("set_email_preference", { p_actor: target.id, p_enabled: true }); }
  });
});
