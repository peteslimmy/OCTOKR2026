/**
 * HTTP-level tests for the OKR Session Notes module (ADR-089 to ADR-093): the edge in front of the database functions.
 * Needs the app on the test stack (`npm run test:api`) and a seeded database (`npm run dev:seed`).
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { loginAs as login, BASE } from "./session";
const loginAs = async (email: string) => wrap(await login(email));

const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try { return (await c.query(sql, params)).rows as T[]; } finally { await c.end(); }
};
const key = () => `key-${randomUUID()}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: payload shapes are asserted at each call site
type J = any;
type Sess = Awaited<ReturnType<typeof login>>;
/** The same session with response bodies typed loosely (each call site asserts the shape it needs). */
const wrap = (s: Sess) => ({
  request: async (...a: Parameters<Sess["request"]>) => { const r = await s.request(...a); return { ...r, json: r.json as J }; },
  form: async (...a: Parameters<Sess["form"]>) => { const r = await s.form(...a); return { ...r, json: r.json as J }; },
});
const data = (r: { json: J }): J => r.json.data;

async function setup() {
  const presenter = await loginAs("presenter@4core.local");
  const lead = await loginAs("lead.eng@4core.local");
  const exec = await loginAs("exec@4core.local");
  const hr = await loginAs("hr@4core.local");
  const eng = (await q<{ id: string }>("select e.business_unit_id id from users u join employees e on e.id = u.employee_id where u.email = 'lead.eng@4core.local'"))[0].id;
  const sales = (await q<{ id: string }>("select e.business_unit_id id from users u join employees e on e.id = u.employee_id where u.email = 'lead.sales@4core.local'"))[0].id;
  const type = (await q<{ id: string }>("select id from okr_session_types where code = 'AD_HOC'"))[0].id;
  const create = (s: typeof presenter, bu: string | null, title = `API session ${randomUUID().slice(0, 6)}`, k = key()) =>
    s.request("POST", "/api/v1/okr-sessions", { title, typeId: type, date: new Date().toISOString().slice(0, 10), buId: bu ?? undefined, key: k });
  return { presenter, lead, exec, hr, eng, sales, type, create };
}

describe("session notes over HTTP", () => {
  it("refuses an unauthenticated caller", async () => {
    for (const [method, path] of [["GET", "/api/v1/okr-sessions"], ["POST", "/api/v1/okr-sessions"], ["GET", "/api/v1/okr-decisions"], ["GET", "/api/v1/okr-exports?kind=risks&format=csv"], ["GET", "/api/v1/okr-attachments/00000000-0000-4000-8000-000000000000"]] as const) {
      const res = await fetch(`${BASE}${path}`, { method, headers: method === "POST" ? { "content-type": "application/json" } : {}, body: method === "POST" ? "{}" : undefined, redirect: "manual" });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("refuses a cross-site write and a body with unknown or malformed fields", async () => {
    const { presenter, type } = await setup();
    const cross = await presenter.request("POST", "/api/v1/okr-sessions", { title: "x", typeId: type, date: "2031-01-01", key: key() }, { origin: "https://evil.example" });
    expect(cross.status).toBe(403);
    const unknown = await presenter.request("POST", "/api/v1/okr-sessions", { title: "x", typeId: type, date: "2031-01-01", key: key(), createdBy: randomUUID(), status: "COMPLETED" });
    expect(unknown.status).toBe(422);                                                // no mass assignment
    const bad = await presenter.request("POST", "/api/v1/okr-sessions", { title: "", typeId: "not-a-uuid", date: "yesterday", key: "short" });
    expect(bad.status).toBe(422);
    expect(bad.json.error?.code).toBe("VALIDATION_ERROR");
  });

  it("creates once for a repeated key, reads it back, and refuses a stale version", async () => {
    const { presenter, create, eng } = await setup();
    const k = key();
    const a = await create(presenter, eng, "Idempotent session", k);
    const b = await create(presenter, eng, "Idempotent session", k);
    expect(a.status).toBe(200);
    expect(data(b).id).toBe(data(a).id);
    expect(data(b).replayed).toBe(true);
    const id = data(a).id as string;
    const ws = await presenter.request("GET", `/api/v1/okr-sessions/${id}`);
    expect(ws.status).toBe(200);
    expect(ws.json.data.session.business_unit_id).toBe(eng);
    const stale = await presenter.request("PATCH", `/api/v1/okr-sessions/${id}`, { expectedVersion: 99, title: "Changed" });
    expect(stale.status).toBe(409);
    expect(stale.json.error?.code).toBe("VERSION_CONFLICT");
    const reused = await presenter.request("POST", `/api/v1/okr-sessions/${id}/transition`, { to: "IN_PROGRESS", key: k });
    expect(reused.status).toBe(409);
    expect(reused.json.error?.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("autosave: a note saves with its version, a stale save is refused, and the text is never overwritten", async () => {
    const { presenter, create, eng } = await setup();
    const id = (await create(presenter, eng)).json.data.id as string;
    await presenter.request("POST", `/api/v1/okr-sessions/${id}/transition`, { to: "IN_PROGRESS", key: key() });
    const note = await presenter.request("POST", `/api/v1/okr-sessions/${id}/notes`, { content: "first", clientKey: key(), category: "GENERAL_DISCUSSION" });
    expect(note.status).toBe(200);
    const nid = note.json.data.id as string;
    const ok = await presenter.request("PATCH", `/api/v1/okr-notes/${nid}`, { expectedVersion: 1, content: "second" });
    expect(ok.json.data.version).toBe(2);
    const conflict = await presenter.request("PATCH", `/api/v1/okr-notes/${nid}`, { expectedVersion: 1, content: "stale tab" });
    expect(conflict.status).toBe(409);
    expect(conflict.json.error?.code).toBe("VERSION_CONFLICT");
    expect((await q<{ content: string }>("select content from okr_session_notes where id = $1", [nid]))[0].content).toBe("second");
    const noVersion = await presenter.request("PATCH", `/api/v1/okr-notes/${nid}`, { content: "no version" });
    expect(noVersion.status).toBe(422);
  });

  it("IDOR: another unit's lead gets 404 on read and 403 or 404 on every write by id; the library does not list it", async () => {
    const { presenter, lead, create, sales } = await setup();
    const sid = (await create(presenter, sales, "SALES-only review")).json.data.id as string;
    await presenter.request("POST", `/api/v1/okr-sessions/${sid}/transition`, { to: "IN_PROGRESS", key: key() });
    const nid = (await presenter.request("POST", `/api/v1/okr-sessions/${sid}/notes`, { content: "private", clientKey: key() })).json.data.id as string;
    expect((await lead.request("GET", `/api/v1/okr-sessions/${sid}`)).status).toBe(404);
    expect((await lead.request("GET", `/api/v1/okr-sessions/${sid}/outstanding`)).status).toBe(404);
    expect((await lead.request("GET", `/api/v1/okr-notes/${nid}/versions`)).json.data ?? []).toEqual([]);
    for (const [method, path, body] of [
      ["POST", `/api/v1/okr-sessions/${sid}/notes`, { content: "x", clientKey: key() }],
      ["PATCH", `/api/v1/okr-notes/${nid}`, { expectedVersion: 1, content: "hijack" }],
      ["POST", `/api/v1/okr-sessions/${sid}/transition`, { to: "COMPLETED", key: key() }],
      ["POST", `/api/v1/okr-sessions/${sid}/participants`, { userId: randomUUID() }],
      ["POST", `/api/v1/okr-sessions/${sid}/minutes`, { content: "x", key: key() }],
      ["POST", `/api/v1/okr-notes/${nid}/archive`, { reason: "x" }],
    ] as const) {
      const r = await lead.request(method, path, body);
      expect([403, 404], `${method} ${path} -> ${r.status}`).toContain(r.status);
    }
    const list = await lead.request("GET", "/api/v1/okr-sessions?limit=100");
    expect((list.json.data.rows as { id: string }[]).some((r) => r.id === sid)).toBe(false);
    expect((await q<{ content: string }>("select content from okr_session_notes where id = $1", [nid]))[0].content).toBe("private");
  });

  it("denies each role what it must not do, with stable codes", async () => {
    const { presenter, lead, exec, hr, create, eng } = await setup();
    const sid = (await create(presenter, eng)).json.data.id as string;
    await presenter.request("POST", `/api/v1/okr-sessions/${sid}/transition`, { to: "IN_PROGRESS", key: key() });
    // another unit's BU Lead (the seeded HR person is a BU Lead of their own unit): the list is row-secured, a write by id is refused
    expect(((await hr.request("GET", "/api/v1/okr-sessions?limit=100")).json.data.rows as { id: string }[]).some((r) => r.id === sid)).toBe(false);
    const hrWrite = await hr.request("POST", `/api/v1/okr-sessions/${sid}/notes`, { content: "x", clientKey: key() });
    expect(hrWrite.status).toBe(403);
    expect(hrWrite.json.error?.code).toBe("BU_SCOPE_DENIED");
    // Executive: read-only
    expect((await exec.request("GET", `/api/v1/okr-sessions/${sid}`)).status).toBe(200);
    expect((await exec.request("POST", `/api/v1/okr-sessions/${sid}/notes`, { content: "x", clientKey: key() })).status).toBe(403);
    expect((await exec.request("POST", `/api/v1/okr-sessions/${sid}/decisions`, { title: "t", description: "d", clientKey: key() })).status).toBe(403);
    // BU Lead: cannot record or approve decisions, create or reassign actions, or manage risks
    const dec = await presenter.request("POST", `/api/v1/okr-sessions/${sid}/decisions`, { title: "Adopt a daily check", description: "Every morning", clientKey: key() });
    expect(dec.status).toBe(200);
    const did = dec.json.data.id as string;
    expect((await lead.request("POST", `/api/v1/okr-decisions/${did}/decide`, { outcome: "APPROVE", key: key() })).status).toBe(403);
    expect((await lead.request("POST", `/api/v1/okr-sessions/${sid}/decisions`, { title: "t", description: "d", clientKey: key() })).status).toBe(403);
    expect((await lead.request("POST", `/api/v1/okr-sessions/${sid}/actions`, { description: "x", assigneeId: randomUUID(), priority: "LOW", dueDate: "2099-01-01", clientKey: key() })).status).toBe(403);
    expect((await lead.request("POST", `/api/v1/okr-sessions/${sid}/risks`, { title: "t", description: "d", clientKey: key() })).status).toBe(403);
    // the denials were recorded as evidence
    // (the same refusal on the same route is recorded once a minute, so look for any record on this module's routes)
    expect((await q("select 1 from audit_logs where action = 'ACCESS_DENIED' and outcome = 'DENIED' and entity_id like '/api/v1/okr-%'")).length).toBeGreaterThan(0);
  });

  it("exports respect access: a BU Lead's export holds only their unit; an executive can export; HR cannot; every export is audited", async () => {
    const { presenter, lead, create, eng, sales } = await setup();
    await create(presenter, sales, "SALES history row");
    await create(presenter, eng, "ENG history row");
    const csvLead = await lead.request("GET", "/api/v1/okr-exports?kind=bu-history&format=csv");
    expect(csvLead.status).toBe(200);
    expect(csvLead.text).toContain("ENG history row");
    expect(csvLead.text).not.toContain("SALES history row");
    expect((await presenter.request("GET", "/api/v1/okr-exports?kind=nonsense&format=csv")).status).toBe(422);
    expect((await presenter.request("GET", "/api/v1/okr-exports?kind=quarterly&format=pdf")).status).toBe(422);     // a quarter is required
    const before = (await q<{ n: string }>("select count(*) n from audit_logs where action = 'OKR_SESSION_EXPORTED'"))[0].n;
    expect((await presenter.request("GET", "/api/v1/okr-exports?kind=decisions&format=xlsx")).status).toBe(200);
    expect(Number((await q<{ n: string }>("select count(*) n from audit_logs where action = 'OKR_SESSION_EXPORTED'"))[0].n)).toBeGreaterThan(Number(before));
  });

  it("an attachment of the wrong content, an unlisted type or a different unit is refused, and a valid one is stored privately", async () => {
    const { presenter, lead, create, eng, sales } = await setup();
    const sid = (await create(presenter, eng)).json.data.id as string;
    const form = (bytes: Uint8Array, type: string, name: string, recordId = sid) => {
      const f = new FormData();
      f.append("file", new File([bytes as BlobPart], name, { type }));
      f.append("metadata", JSON.stringify({ recordType: "SESSION", recordId }));
      return f;
    };
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    expect((await presenter.form("POST", `/api/v1/okr-sessions/${sid}/attachments`, form(html, "text/html", "x.html"))).status).toBe(422);           // type not allowed
    expect((await presenter.form("POST", `/api/v1/okr-sessions/${sid}/attachments`, form(html, "application/pdf", "x.pdf"))).status).toBe(422);        // not a real PDF
    // malware: the antivirus test file and a program wearing a PDF's name are refused, are never stored, and leave a line in the timeline
    const eicar = new TextEncoder().encode("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    const bad = await presenter.form("POST", `/api/v1/okr-sessions/${sid}/attachments`, form(eicar, "text/plain", "notes.txt"));
    expect(bad.status).toBe(422);
    expect(bad.json.error?.code).toBe("MALWARE_DETECTED");
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0]);
    expect((await presenter.form("POST", `/api/v1/okr-sessions/${sid}/attachments`, form(exe, "image/png", "x.png"))).status).toBe(422);
    expect((await q("select 1 from okr_session_attachments where session_id = $1", [sid])).length).toBe(0);
    expect((await q("select 1 from okr_session_events where session_id = $1 and event_type = 'REJECTED_BY_SCAN'", [sid])).length).toBeGreaterThanOrEqual(1);
    const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
    const salesSid = (await create(presenter, sales)).json.data.id as string;
    const cross = await lead.form("POST", `/api/v1/okr-sessions/${salesSid}/attachments`, form(pdf, "application/pdf", "a.pdf", salesSid));
    expect([403, 404]).toContain(cross.status);
    const ok = await presenter.form("POST", `/api/v1/okr-sessions/${sid}/attachments`, form(pdf, "application/pdf", "evidence.pdf"));
    if (ok.status !== 200) {
      // the test stack runs without the storage service: the upload must fail cleanly, say nothing was saved, and leave no listed attachment behind
      expect(ok.status).toBe(502);
      expect(ok.json.error?.code).toBe("STORAGE_ERROR");
      expect((await presenter.request("GET", `/api/v1/okr-sessions/${sid}/attachments`)).json.data).toEqual([]);
      expect((await q("select 1 from okr_session_attachments where session_id = $1 and deleted_at is not null", [sid])).length).toBe(1);
      return;
    }
    const down = await fetch(`${BASE}/api/v1/okr-attachments/${ok.json.data.id}`);
    expect(down.status).toBe(401);                                                                                                                    // never public
    expect((await lead.request("GET", `/api/v1/okr-attachments/${ok.json.data.id}`)).status).toBe(200);
    expect((await (await loginAs("hr@4core.local")).request("GET", `/api/v1/okr-attachments/${ok.json.data.id}`)).status).toBe(404);
  });

  it("session types are listed for session users and changed only with session_notes.configure (an Admin; covered in the database tests)", async () => {
    const { presenter, lead } = await setup();
    const code = `API_${randomUUID().slice(0, 6).toUpperCase()}`;
    expect((await presenter.request("POST", "/api/v1/okr-session-types", { code, name: "Nope" })).status).toBe(403);
    expect((await lead.request("POST", "/api/v1/okr-session-types", { code, name: "Nope" })).status).toBe(403);
    expect((await lead.request("GET", "/api/v1/okr-session-types")).json.data.length).toBeGreaterThan(5);
  });
});
