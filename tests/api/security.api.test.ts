/**
 * HTTP-level tests for authentication hardening (milestone 4, ADR-052): second factor, password reset and change, CSP.
 * Needs `npm run dev` and a seeded database (`npm run dev:seed`, which also enrols the elevated users' authenticators).
 */
import { existsSync, readFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { DEV_MFA_FILE, totp } from "../../scripts/totp";
import { completeMfa } from "./mfa-login";

config({ path: ".env.local" });
const BASE = process.env.API_BASE ?? "http://localhost:3000";
const PASSWORD = "DevPassword!2026";

class Session {
  private jar = new Map<string, string>();
  /** A distinct client address per session, so the per-IP sign-in limiter does not couple unrelated tests (production sits behind a proxy that sets this header). */
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
    return { status: res.status, json, headers: res.headers };
  }
}
const login = (s: Session, email: string, password = PASSWORD) => s.request("POST", "/api/v1/auth/login", { email, password });

describe("second factor (MFA)", () => {
  it("a password alone gives elevated users an incomplete session that the API refuses", async () => {
    for (const email of ["admin@4core.local", "finance@4core.local", "superadmin@4core.local"]) {
      const s = new Session();
      const r = await login(s, email);
      expect(r.status).toBe(200);
      expect(r.json.data.mfaRequired, email).toBe(true);
      expect((await s.request("GET", "/api/v1/audit")).json.error?.code, email).toBe("MFA_REQUIRED");
      expect((await s.request("GET", "/api/v1/auth/mfa/status")).status).toBe(200);   // the challenge itself stays reachable
    }
  });

  it("a wrong code is refused with a generic message; a correct one completes the sign-in", async () => {
    const s = new Session();
    await login(s, "admin@4core.local");
    const bad = await s.request("POST", "/api/v1/auth/mfa/verify", { code: "000000" });
    expect(bad.status).toBe(401);
    expect(bad.json.error?.code).toBe("AUTHENTICATION_FAILED");
    expect((await s.request("POST", "/api/v1/auth/mfa/verify", { code: "12ab56" })).status).toBe(422);
    const ok = await login(new Session(), "admin@4core.local");
    expect(ok.json.data.mfaRequired).toBe(true);
    const done = new Session();
    const r = await login(done, "admin@4core.local");
    await completeMfa(done, "admin@4core.local", r);
    const me = (await done.request("GET", "/api/v1/auth/me")).json.data;
    expect(me.mfa).toMatchObject({ required: true, enrolled: true, aal: "aal2" });
    expect((await done.request("GET", "/api/v1/audit")).status).toBe(200);
  });

  it("ordinary roles are not asked for a second factor, and cannot create one for someone else", async () => {
    const s = new Session();
    const r = await login(s, "lead.eng@4core.local");
    expect(r.json.data.mfaRequired).toBeUndefined();
    expect((await s.request("GET", "/api/v1/auth/me")).json.data.mfa).toMatchObject({ required: false, enrolled: false });
    expect((await s.request("POST", "/api/v1/users/11111111-1111-4111-8111-111111111111/mfa-reset", { reason: "x" })).status).toBe(403);
    expect((await s.request("POST", "/api/v1/auth/mfa/disable", { code: "123456" })).status).toBe(409);   // nothing to remove
  });

  it("a required role cannot remove its authenticator", async () => {
    const s = new Session();
    await completeMfa(s, "finance@4core.local", await login(s, "finance@4core.local"));
    const secret = (JSON.parse(readFileSync(DEV_MFA_FILE, "utf8")) as Record<string, string>)["finance@4core.local"];
    const r = await s.request("POST", "/api/v1/auth/mfa/disable", { code: totp(secret) });
    expect(r.status).toBe(403);
    expect(r.json.error?.code).toBe("MFA_REQUIRED_BY_ROLE");
  });

  it("authenticator reset is limited to users.manage and rejects blank reasons", async () => {
    const admin = new Session();
    await completeMfa(admin, "admin@4core.local", await login(admin, "admin@4core.local"));
    const target = "11111111-1111-4111-8111-111111111111";
    expect((await admin.request("POST", `/api/v1/users/${target}/mfa-reset`, { reason: " " })).status).toBe(422);
    expect((await admin.request("POST", `/api/v1/users/${target}/mfa-reset`, { reason: "lost phone" })).status).toBe(404);
    const hr = new Session();
    await login(hr, "hr@4core.local");
    expect((await hr.request("POST", `/api/v1/users/${target}/mfa-reset`, { reason: "lost phone" })).status).toBe(403);
  });
});

describe("voluntary authenticator for ordinary roles", () => {
  it("enrol → challenged at the next sign-in → step-up works → remove", async () => {
    const email = "director@4core.local";
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    try {
      await enrolFlow(email);
    } finally {
      // always leave the account without an authenticator, even if an assertion above failed
      const users = (await admin.auth.admin.listUsers({ perPage: 200 })).data.users;
      const id = users.find((u) => u.email === email)?.id;
      if (id) for (const f of (await admin.auth.admin.mfa.listFactors({ userId: id })).data?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: id });
    }
  });
});

async function enrolFlow(email: string) {
  {
    // (runs before the password-reset tests below; leaves the account exactly as it found it)
    const s = new Session();
    expect((await login(s, email)).json.data.mfaRequired).toBeUndefined();
    const enrol = await s.request("POST", "/api/v1/auth/mfa/enroll");
    expect(enrol.status).toBe(200);
    expect(enrol.json.data.qrCode).toContain("data:image/svg+xml");
    const { factorId } = enrol.json.data as { factorId: string };
    expect((await s.request("POST", "/api/v1/auth/mfa/enroll")).status).toBe(200);               // abandoned attempts are replaced, not stacked
    const second = (await s.request("POST", "/api/v1/auth/mfa/enroll")).json.data as { factorId: string; secret: string };
    expect(second.factorId).not.toBe(factorId);
    expect((await s.request("POST", "/api/v1/auth/mfa/verify", { code: totp(second.secret), factorId: second.factorId })).json.data.enrolled).toBe(true);
    expect((await s.request("POST", "/api/v1/auth/mfa/enroll")).json.error?.code).toBe("MFA_ALREADY_ENROLLED");

    const again = new Session();
    expect((await login(again, email)).json.data.mfaRequired).toBe(true);                         // now challenged like everyone enrolled
    expect((await again.request("GET", "/api/v1/notifications")).json.error?.code).toBe("MFA_REQUIRED");   // password-only session is refused
    let verified = false;
    for (const off of [0, 30_000, -30_000, 60_000]) {
      if ((await again.request("POST", "/api/v1/auth/mfa/verify", { code: totp(second.secret, Date.now() + off) })).status === 200) { verified = true; break; }
    }
    expect(verified).toBe(true);
    expect((await again.request("GET", "/api/v1/auth/me")).json.data.mfa).toMatchObject({ enrolled: true, aal: "aal2" });
    let removed = 0;
    for (const off of [0, 30_000, -30_000, 60_000]) {
      const r = await again.request("POST", "/api/v1/auth/mfa/disable", { code: totp(second.secret, Date.now() + off) });
      if (r.status === 200) { removed = 1; break; }
    }
    expect(removed).toBe(1);
    expect((await login(new Session(), email)).json.data.mfaRequired).toBeUndefined();
  }
}

describe("password reset and change", () => {
  it("the forgot-password answer is identical for known and unknown accounts", async () => {
    const a = await new Session().request("POST", "/api/v1/auth/password/forgot", { email: "exec@4core.local" });
    const b = await new Session().request("POST", "/api/v1/auth/password/forgot", { email: "nobody-here@4core.local" });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.json.data).toEqual(b.json.data);
    expect((await new Session().request("POST", "/api/v1/auth/password/forgot", { email: "not-an-email" })).status).toBe(422);
  });

  it("an ordinary signed-in session cannot use the reset endpoint to skip the current password", async () => {
    const s = new Session();
    await login(s, "lead.eng2@4core.local");
    const r = await s.request("POST", "/api/v1/auth/password/reset", { password: "Another-Strong-Pass1" });
    expect(r.status).toBe(403);
    expect(r.json.error?.code).toBe("RECOVERY_REQUIRED");
    expect((await new Session().request("POST", "/api/v1/auth/password/reset", { password: "Another-Strong-Pass1" })).status).toBe(401);
  });

  it("change requires the current password and a policy-compliant new one", async () => {
    const s = new Session();
    await login(s, "lead.sales@4core.local");
    const wrong = await s.request("POST", "/api/v1/auth/password/change", { currentPassword: "not-the-password", newPassword: "Another-Strong-Pass1" });
    expect(wrong.status).toBe(401);
    const weak = await s.request("POST", "/api/v1/auth/password/change", { currentPassword: PASSWORD, newPassword: "short" });
    expect(weak.status).toBe(422);
    expect(weak.json.error?.code).toBe("PASSWORD_POLICY");
    const same = await s.request("POST", "/api/v1/auth/password/change", { currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.json.error?.code).toBe("PASSWORD_POLICY");
    expect((await new Session().request("POST", "/api/v1/auth/password/change", { currentPassword: PASSWORD, newPassword: "Another-Strong-Pass1" })).status).toBe(401);
  });

  it("the full emailed-link flow works once: link → new password → old sessions ended → link is single-use", async () => {
    const email = "director@4core.local";   // used by no other test file, so the temporary password cannot disturb parallel runs
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const tmp = "Temporary-Pass-2026x";
    const recover = async (newPassword: string) => {
      const link = await admin.auth.admin.generateLink({ type: "recovery", email });
      expect(link.error).toBeNull();
      const hash = link.data?.properties?.hashed_token ?? "";
      expect(hash).not.toBe("");
      const s = new Session();
      const confirm = await s.request("GET", `/auth/confirm?token_hash=${hash}&type=recovery`);
      expect([302, 307]).toContain(confirm.status);
      expect(confirm.headers.get("location")).toContain("/reset-password");
      const weak = await s.request("POST", "/api/v1/auth/password/reset", { password: "weak" });
      expect(weak.json.error?.code).toBe("PASSWORD_POLICY");
      const done = await s.request("POST", "/api/v1/auth/password/reset", { password: newPassword });
      expect(done.status, JSON.stringify(done.json)).toBe(200);
      expect((await s.request("GET", "/api/v1/auth/me")).status).toBe(401);            // every session ended
      const reuse = await new Session().request("GET", `/auth/confirm?token_hash=${hash}&type=recovery`);
      expect(reuse.headers.get("location")).toContain("/forgot-password?expired=1");  // single use
    };
    await recover(tmp);
    const old = await login(new Session(), email, PASSWORD);
    expect(old.status).toBe(401);
    expect((await login(new Session(), email, tmp)).status).toBe(200);
    await recover(PASSWORD);                                                           // restore the seeded credential
    expect((await login(new Session(), email, PASSWORD)).status).toBe(200);
  });

  it("rejects malformed or foreign confirmation links", async () => {
    const s = new Session();
    expect((await s.request("GET", "/auth/confirm")).headers.get("location")).toContain("expired=1");
    expect((await s.request("GET", "/auth/confirm?token_hash=abc&type=magiclink")).headers.get("location")).toContain("expired=1");
    expect((await s.request("GET", "/auth/confirm?token_hash=abc&type=recovery")).headers.get("location")).toContain("expired=1");
  });
});

describe("Content-Security-Policy and headers", () => {
  it("sends a strict, per-request nonce policy on pages", async () => {
    const get = async () => (await fetch(`${BASE}/login`)).headers.get("content-security-policy") ?? "";
    const a = await get();
    const b = await get();
    expect(a).toContain("default-src 'self'");
    expect(a).toContain("frame-ancestors 'none'");
    expect(a).toContain("object-src 'none'");
    expect(a).toContain("base-uri 'self'");
    expect(a).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(a).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(a.match(/nonce-([^']+)/)?.[1]).not.toBe(b.match(/nonce-([^']+)/)?.[1]);
  });

  it("keeps the other security headers", async () => {
    const h = (await fetch(`${BASE}/login`)).headers;
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(existsSync(DEV_MFA_FILE)).toBe(true);
  });
});
