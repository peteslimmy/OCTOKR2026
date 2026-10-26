import { config } from "dotenv";
import { completeMfa } from "./mfa-login";

config({ path: ".env.local" });

export const BASE = process.env.API_BASE ?? "http://localhost:3100";
export const PASSWORD = "DevPassword!2026";

/** The seeded people (npm run dev:seed on the test stack) and the roles each holds. */
export const ROLE_ACCOUNTS: Record<string, string[]> = {
  "superadmin@4core.local": ["SUPER_ADMIN"],
  "admin@4core.local": ["ADMIN"],
  "hr@4core.local": ["HR", "BU_LEAD"],
  "finance@4core.local": ["FINANCE", "BU_LEAD"],
  "lead.eng@4core.local": ["BU_LEAD"],
  "presenter@4core.local": ["PRESENTER"],
  "director@4core.local": ["DIRECTOR"],
  "exec@4core.local": ["EXECUTIVE"],
};

/** A cookie-keeping HTTP client with a distinct client address, so the per-address sign-in limiter does not couple unrelated sessions. */
export class Session {
  private jar = new Map<string, string>();
  private ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

  private async send(method: string, path: string, init: { headers?: Record<string, string>; body?: BodyInit }) {
    const res = await fetch(`${BASE}${path}`, {
      method, redirect: "manual", body: init.body,
      headers: { ...(init.headers ?? {}), "x-forwarded-for": this.ip, cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") },
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (value === "" || /max-age=0/i.test(c)) this.jar.delete(name); else this.jar.set(name, value);
    }
    const text = await res.text();
    let json: { data?: unknown; error?: { code: string; message: string } } = {};
    try { json = JSON.parse(text); } catch { /* not JSON (a page or a file) */ }
    return { status: res.status, json, text };
  }

  async request(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    return this.send(method, path, { headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...extraHeaders }, body: body !== undefined ? JSON.stringify(body) : undefined });
  }

  /** A multipart/form-data request (file uploads); the boundary header is set by fetch. */
  async form(method: string, path: string, data: FormData) {
    return this.send(method, path, { body: data });
  }
}

const sessions = new Map<string, Session>();   // one sign-in per account: the server rate-limits sign-ins
export async function loginAs(email: string): Promise<Session> {
  const cached = sessions.get(email);
  if (cached) return cached;
  const s = new Session();
  const r = await s.request("POST", "/api/v1/auth/login", { email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`sign-in as ${email} returned ${r.status}`);
  await completeMfa(s, email, r);
  sessions.set(email, s);
  return s;
}
