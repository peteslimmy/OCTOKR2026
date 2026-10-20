/**
 * HTTP-level tests for lost-authenticator recovery (ADR-060): recovery codes at setup, regeneration, use at sign-in, session revocation
 * and guessing limits. Needs `npm run dev` (or start) and a seeded database (`npm run dev:seed`).
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { totp } from "../../scripts/totp";

config({ path: ".env.local" });
const BASE = process.env.API_BASE ?? "http://localhost:3000";
const PASSWORD = "DevPassword!2026";

class Session {
  private jar = new Map<string, string>();
  /** A distinct client address per session, so the per-IP sign-in limiter does not couple unrelated tests. */
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
const login = (s: Session, email: string, password = PASSWORD) => s.request("POST", "/api/v1/auth/login", { email, password });

// ordinary roles: the authenticator is voluntary, so each account can be left exactly as it was found. One account per test keeps the per-account sign-in limit out of the way.
const ACCOUNTS = ["presenter@4core.local", "exec@4core.local", "lead.sales@4core.local", "lead.eng2@4core.local"];
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function strip(EMAIL: string) {
  const a = admin();
  const id = (await a.auth.admin.listUsers({ perPage: 200 })).data.users.find((u) => u.email === EMAIL)?.id;
  if (id) for (const f of (await a.auth.admin.mfa.listFactors({ userId: id })).data?.factors ?? []) await a.auth.admin.mfa.deleteFactor({ id: f.id, userId: id });
  await a.from("users").update({ failed_attempts: 0, locked_until: null }).eq("email", EMAIL);   // wrong-code tests count toward the lockout; leave the account usable
}
async function verifyWithTotp(s: Session, secret: string) {
  for (const off of [0, 30_000, -30_000, 60_000]) {
    const r = await s.request("POST", "/api/v1/auth/mfa/verify", { code: totp(secret, Date.now() + off) });
    if (r.status === 200) return r;
  }
  throw new Error("could not pass the authenticator step");
}
async function enrolled(EMAIL: string) {
  const s = new Session();
  expect((await login(s, EMAIL)).status).toBe(200);
  const e = (await s.request("POST", "/api/v1/auth/mfa/enroll")).json.data as { factorId: string; secret: string };
  const done = await s.request("POST", "/api/v1/auth/mfa/verify", { code: totp(e.secret), factorId: e.factorId });
  return { s, secret: e.secret, codes: done.json.data.recoveryCodes as string[] };
}

describe("recovery codes", () => {
  it("are shown once when the authenticator is activated, stored only as hashes, and counted without being revealed", async () => {
    const EMAIL = ACCOUNTS[0];
    await strip(EMAIL);
    try {
      const { s, codes } = await enrolled(EMAIL);
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      for (const c of codes) expect(c).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      const st = await s.request("GET", "/api/v1/auth/mfa/status");
      expect(st.json.data.recoveryCodesRemaining).toBe(10);
      expect(JSON.stringify(st.json)).not.toContain(codes[0]);
    } finally { await strip(EMAIL); }
  });

  it("a new set needs a fresh authenticator check and cancels the old one", async () => {
    const EMAIL = ACCOUNTS[1];
    await strip(EMAIL);
    try {
      const first = await enrolled(EMAIL);
      const again = new Session();
      await login(again, EMAIL);
      expect((await again.request("POST", "/api/v1/auth/mfa/recovery-codes")).json.error?.code).toBe("MFA_REQUIRED");        // password-only session is refused
      await verifyWithTotp(again, first.secret);
      const fresh = await again.request("POST", "/api/v1/auth/mfa/recovery-codes");
      expect(fresh.status).toBe(200);
      const codes = fresh.json.data.recoveryCodes as string[];
      expect(codes).toHaveLength(10);
      expect(codes.some((c) => first.codes.includes(c))).toBe(false);
      const probe = new Session();
      await login(probe, EMAIL);
      const old = await probe.request("POST", "/api/v1/auth/mfa/recover", { code: first.codes[0] });
      expect(old.status).toBe(401);                                                          // the first set no longer works
      expect(old.json.error?.code).toBe("AUTHENTICATION_FAILED");
    } finally { await strip(EMAIL); }
  });

  it("recovering with a code removes the authenticator, ends other sessions, spends the code and tells the person", async () => {
    const EMAIL = ACCOUNTS[2];
    await strip(EMAIL);
    try {
      const { s: setup, secret, codes } = await enrolled(EMAIL);
      const bystander = new Session();
      await login(bystander, EMAIL);
      await verifyWithTotp(bystander, secret);                                               // a second, fully signed-in session
      expect((await bystander.request("GET", "/api/v1/auth/me")).status).toBe(200);

      const locked = new Session();
      expect((await login(locked, EMAIL)).json.data.mfaRequired).toBe(true);                 // password-only: this is the lost-device situation
      const typed = codes[2].toLowerCase().replace(/-/g, " ");                                // how a person might type it
      const r = await locked.request("POST", "/api/v1/auth/mfa/recover", { code: typed });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.data).toMatchObject({ ok: true, mfaEnrolmentRequired: false });

      expect((await locked.request("GET", "/api/v1/auth/mfa/status")).json.data).toMatchObject({ enrolled: false });
      expect((await bystander.request("GET", "/api/v1/auth/me")).status).toBe(401);          // other sessions are gone
      expect((await setup.request("GET", "/api/v1/auth/me")).status).toBe(401);
      expect((await locked.request("GET", "/api/v1/auth/me")).status).toBe(200);             // the recovering session carries on, at password level
      const notes = await locked.request("GET", "/api/v1/notifications");
      expect(JSON.stringify(notes.json)).toContain("recovery code was used");

      // the same code cannot be used again, even after setting up a new authenticator
      const e2 = (await locked.request("POST", "/api/v1/auth/mfa/enroll")).json.data as { factorId: string; secret: string };
      const done = await locked.request("POST", "/api/v1/auth/mfa/verify", { code: totp(e2.secret), factorId: e2.factorId });
      expect(done.json.data.recoveryCodes).toHaveLength(10);
      const again = new Session();
      await login(again, EMAIL);
      expect((await again.request("POST", "/api/v1/auth/mfa/recover", { code: codes[2] })).status).toBe(401);
    } finally { await strip(EMAIL); }
  });

  it("answers wrong, malformed and missing codes alike, rate-limits guessing and needs an authenticator to exist", async () => {
    const EMAIL = ACCOUNTS[3];
    await strip(EMAIL);
    try {
      const none = new Session();
      await login(none, EMAIL);
      expect((await none.request("POST", "/api/v1/auth/mfa/recover", { code: "ABCD-EFGH-JKMN" })).json.error?.code).toBe("MFA_NOT_ENROLLED");
      expect((await new Session().request("POST", "/api/v1/auth/mfa/recover", { code: "ABCD-EFGH-JKMN" })).status).toBe(401);
      await enrolled(EMAIL);
      const s = new Session();
      await login(s, EMAIL);
      const seen = new Set<string>();
      for (const code of ["ABCD-EFGH-JKMN", "not a code", "0000-0000-0000", "12345678"]) {
        const r = await s.request("POST", "/api/v1/auth/mfa/recover", { code });
        expect([401, 422]).toContain(r.status);
        seen.add(`${r.status}:${r.json.error?.code}`);
      }
      expect([...seen].filter((x) => x.startsWith("401")).length).toBe(1);                   // one generic answer
      expect((await s.request("POST", "/api/v1/auth/mfa/recover", { code: "ABCD-EFGH-JKMN", extra: 1 })).status).toBe(422);
      let limited = false;
      for (let i = 0; i < 8 && !limited; i++) limited = (await s.request("POST", "/api/v1/auth/mfa/recover", { code: "ZZZZ-ZZZZ-ZZZZ" })).status === 429;
      expect(limited).toBe(true);
    } finally { await strip(EMAIL); }
  });
});
