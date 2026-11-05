/**
 * HTTP-level tests for the Executive Oversight module (ADR-096 to ADR-103): the edge in front of the database functions.
 * Needs the app on the test stack (`npm run test:api`) and a seeded database (`npm run dev:seed`).
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { loginAs as login } from "./session";

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
const wrap = (s: Sess) => ({
  request: async (...a: Parameters<Sess["request"]>) => { const r = await s.request(...a); return { ...r, json: r.json as J }; },
  form: async (...a: Parameters<Sess["form"]>) => { const r = await s.form(...a); return { ...r, json: r.json as J }; },
});
const loginAs = async (email: string) => wrap(await login(email));
const data = (r: { json: J }): J => r.json.data;
const buOf = async (email: string) => (await q<{ id: string }>("select e.business_unit_id id from users u join employees e on e.id = u.employee_id where u.email = $1", [email]))[0].id;

async function setup() {
  const exec = await loginAs("exec@4core.local");
  const director = await loginAs("director@4core.local");
  const eng = await loginAs("lead.eng@4core.local");
  const sales = await loginAs("lead.sales@4core.local");
  const presenter = await loginAs("presenter@4core.local");
  const hr = await loginAs("hr@4core.local");
  const engBu = await buOf("lead.eng@4core.local"), salesBu = await buOf("lead.sales@4core.local");
  const comment = (s: typeof exec, over: Record<string, unknown> = {}) =>
    s.request("POST", "/api/v1/executive-comments", { businessUnitId: engBu, module: "DASHBOARD", content: `Observation ${randomUUID().slice(0, 6)}`, requestKey: key(), ...over });
  const rec = (s: typeof exec, over: Record<string, unknown> = {}) =>
    s.request("POST", "/api/v1/executive-recommendations", { title: `Improve intake ${randomUUID().slice(0, 6)}`, detail: "Automate the intake form.", reason: "Delays", module: "BU_PERFORMANCE", targets: [engBu], publish: true, responseRequested: true, requestKey: key(), ...over });
  return { exec, director, eng, sales, presenter, hr, engBu, salesBu, comment, rec };
}

describe("authentication and permissions at the edge", () => {
  it("refuses an anonymous caller everywhere", async () => {
    const anon = wrap(new (await import("./session")).Session());
    for (const [m, p] of [["GET", "/api/v1/executive-comments"], ["GET", "/api/v1/executive-recommendations"], ["GET", "/api/v1/executive-oversight/dashboard"], ["POST", "/api/v1/executive-comments"]] as const) {
      expect((await anon.request(m, p, m === "POST" ? {} : undefined)).status).toBe(401);
    }
  });

  it("lets only Executives and Directors start a comment or a recommendation", async () => {
    const w = await setup();
    expect((await w.comment(w.exec)).status).toBe(200);
    expect((await w.comment(w.director)).status).toBe(200);
    for (const s of [w.eng, w.presenter, w.hr]) {
      const c = await w.comment(s);
      expect(c.status).toBe(403);
      expect(c.json.error.code).toBe("PERMISSION_DENIED");
      expect((await w.rec(s)).status).toBe(403);
    }
  });

  it("rejects fields that would let a caller choose the author, the role or the status", async () => {
    const w = await setup();
    for (const extra of [{ authorId: randomUUID() }, { authorRole: "ADMIN" }, { status: "CLOSED" }, { createdAt: "2020-01-01T00:00:00Z" }]) {
      const r = await w.comment(w.exec, extra);
      expect(r.status).toBe(422);
      expect(r.json.error.code).toBe("VALIDATION_ERROR");
    }
    const mine = (await q<{ author_id: string; author_role: string }>("select author_id, author_role from eo_comments order by created_at desc limit 1"))[0];
    expect(mine.author_role).not.toBe("ADMIN");
  });

  it("opens the dashboard to those who hold the permission and to nobody else", async () => {
    const w = await setup();
    const d = await w.exec.request("GET", "/api/v1/executive-oversight/dashboard");
    expect(d.status).toBe(200);
    expect(typeof data(d).comments_total).toBe("number");
    expect((await w.eng.request("GET", "/api/v1/executive-oversight/dashboard")).status).toBe(200);
    expect((await w.hr.request("GET", "/api/v1/executive-oversight/dashboard")).status).toBe(200);          // the seeded HR account is also a BU Lead: it sees its own unit only
    expect(data(await w.hr.request("GET", "/api/v1/executive-oversight/dashboard")).comments_total).toBeGreaterThanOrEqual(0);
    expect((await w.presenter.request("GET", "/api/v1/executive-oversight/dashboard")).status).toBe(403);
  });
});

describe("comments over HTTP", () => {
  it("posts, lists, reads and replies, and keeps another unit out (IDOR/BOLA)", async () => {
    const w = await setup();
    const created = await w.comment(w.exec, { title: "Intake delays", content: "Intake is **slow** this week" });
    expect(created.status).toBe(200);
    const id = data(created).id as string;
    expect(data(created).reference).toMatch(/^EOC-\d{4}-\d{4}$/);

    expect((await w.eng.request("GET", `/api/v1/executive-comments/${id}`)).status).toBe(200);
    expect((await w.sales.request("GET", `/api/v1/executive-comments/${id}`)).status).toBe(404);                // not found and not permitted look alike
    expect((await w.hr.request("GET", `/api/v1/executive-comments/${id}`)).status).toBe(404);
    expect((await w.presenter.request("GET", `/api/v1/executive-comments/${id}`)).status).toBe(200);          // Presenters read every unit
    expect((await w.presenter.request("POST", `/api/v1/executive-comments/${id}/amend`, { expectedVersion: 1, content: "x", reason: "x" })).status).toBe(403);
    const mineList = await w.eng.request("GET", "/api/v1/executive-comments?limit=100");
    expect(data(mineList).rows.some((r: J) => r.id === id)).toBe(true);
    const otherList = await w.sales.request("GET", "/api/v1/executive-comments?limit=100");
    expect(data(otherList).rows.some((r: J) => r.id === id)).toBe(false);
    expect((await w.hr.request("GET", "/api/v1/executive-comments")).json.data.total).toBe(0);

    expect((await w.sales.request("POST", `/api/v1/executive-comments/${id}/replies`, { content: "hello" })).status).toBe(403);
    const reply = await w.eng.request("POST", `/api/v1/executive-comments/${id}/replies`, { content: "Fixed on Monday", requestKey: key() });
    expect(reply.status).toBe(200);
    const thread = data(await w.exec.request("GET", `/api/v1/executive-comments/${id}`));
    expect(thread.replies).toBe(1);
    expect(thread.events.at(-1)).toMatchObject({ event_type: "REPLY", actor_role: "BU_LEAD" });
    // the reply did not touch the original
    expect(thread.content).toBe("Intake is **slow** this week");
  });

  it("repeats nothing on a duplicate request and refuses a key reused for another act", async () => {
    const w = await setup();
    const k = key();
    const a = await w.comment(w.exec, { requestKey: k });
    const b = await w.comment(w.exec, { requestKey: k });
    expect(data(b).id).toBe(data(a).id);
    expect(data(b).replayed).toBe(true);
    const bad = await w.exec.request("POST", `/api/v1/executive-comments/${data(a).id}/replies`, { content: "x", requestKey: k });
    expect(bad.status).toBe(409);
    expect(bad.json.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("amends only by its author, with a reason, keeping the earlier wording; refuses a stale version", async () => {
    const w = await setup();
    const id = data(await w.comment(w.exec, { content: "First wording" })).id as string;
    expect((await w.eng.request("POST", `/api/v1/executive-comments/${id}/amend`, { expectedVersion: 1, content: "x", reason: "x" })).status).toBe(403);
    expect((await w.director.request("POST", `/api/v1/executive-comments/${id}/amend`, { expectedVersion: 1, content: "x", reason: "x" })).status).toBe(403);
    expect((await w.exec.request("POST", `/api/v1/executive-comments/${id}/amend`, { expectedVersion: 1, content: "Second wording" })).status).toBe(422);   // a reason is required
    const stale = await w.exec.request("POST", `/api/v1/executive-comments/${id}/amend`, { expectedVersion: 9, content: "Second wording", reason: "typo" });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("VERSION_CONFLICT");
    expect((await w.exec.request("POST", `/api/v1/executive-comments/${id}/amend`, { expectedVersion: 1, content: "Second wording", reason: "typo" })).status).toBe(200);
    const history = data(await w.eng.request("GET", `/api/v1/executive-comments/${id}/history`));
    expect(history.versions[0]).toMatchObject({ content: "First wording", reason: "typo" });
  });

  it("refuses a comment about a record of another unit and about a record that does not exist", async () => {
    const w = await setup();
    const foreign = (await q<{ id: string }>("select id from weekly_reports where business_unit_id = $1 limit 1", [w.salesBu]))[0];
    if (foreign) {
      const r = await w.comment(w.exec, { businessUnitId: w.engBu, module: "WEEKLY_REPORT", subjectType: "WEEKLY_REPORT", subjectId: foreign.id });
      expect(r.status).toBe(422);
      expect(r.json.error.code).toBe("LINK_TARGET_INVALID");
    }
    const ghost = await w.comment(w.exec, { module: "TASK", subjectType: "TASK", subjectId: randomUUID() });
    expect(ghost.status).toBe(422);
    expect(ghost.json.error.code).toBe("LINK_TARGET_INVALID");
  });

  it("keeps management-only comments from the unit", async () => {
    const w = await setup();
    const id = data(await w.comment(w.exec, { visibility: "MANAGEMENT" })).id as string;
    expect((await w.eng.request("GET", `/api/v1/executive-comments/${id}`)).status).toBe(404);
    expect((await w.director.request("GET", `/api/v1/executive-comments/${id}`)).status).toBe(200);
  });

  it("stores script text as text and never alters the stored words (rendering escapes it)", async () => {
    const w = await setup();
    const evil = "<script>alert(document.cookie)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1))";
    const id = data(await w.comment(w.exec, { content: evil, title: "<b>t</b>" })).id as string;
    const back = data(await w.eng.request("GET", `/api/v1/executive-comments/${id}`));
    expect(back.content).toBe(evil);
    expect((await w.eng.request("GET", `/api/v1/executive-comments/${id}`)).status).toBe(200);
    const page = await w.eng.request("GET", `/executive-oversight/comments/${id}`);
    expect(page.status).toBe(200);
    expect((page as unknown as { text: string }).text).not.toMatch(/<script>alert\(document/);
  });
});

describe("recommendations over HTTP", () => {
  it("runs the whole journey: issue, acknowledge, decline with a reason, follow up, close", async () => {
    const w = await setup();
    const issued = await w.rec(w.exec, { priority: "HIGH", responseDue: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10) });
    expect(issued.status).toBe(200);
    const id = data(issued).id as string;
    expect(data(issued).reference).toMatch(/^EOR-\d{4}-\d{4}$/);

    const detail = data(await w.eng.request("GET", `/api/v1/executive-recommendations/${id}`));
    expect(detail.targets).toHaveLength(1);
    const target = detail.targets[0].target_id as string;
    expect(detail.targets[0].status).toBe("SUBMITTED");

    expect((await w.sales.request("GET", `/api/v1/executive-recommendations/${id}`)).status).toBe(404);
    expect((await w.hr.request("GET", `/api/v1/executive-recommendations/${id}`)).status).toBe(404);
    // the Executive cannot answer for the unit, nor another unit's lead
    expect((await w.exec.request("POST", `/api/v1/executive-recommendation-targets/${target}/acknowledge`, {})).status).toBe(403);
    expect((await w.sales.request("POST", `/api/v1/executive-recommendation-targets/${target}/acknowledge`, {})).status).toBe(403);

    expect((await w.eng.request("POST", `/api/v1/executive-recommendation-targets/${target}/acknowledge`, { requestKey: key() })).status).toBe(200);
    const noReason = await w.eng.request("POST", `/api/v1/executive-recommendation-targets/${target}/respond`, { decision: "DECLINE" });
    expect(noReason.status).toBe(422);
    expect(noReason.json.error.code).toBe("REASON_REQUIRED");
    const declined = await w.eng.request("POST", `/api/v1/executive-recommendation-targets/${target}/respond`, { decision: "DECLINE", body: "No capacity this quarter", requestKey: key() });
    expect(declined.status).toBe(200);
    expect(data(declined).status).toBe("NOT_ACCEPTED");
    // advice declined: it can neither be progressed nor answered again
    expect((await w.eng.request("POST", `/api/v1/executive-recommendation-targets/${target}/progress`, { kind: "PROGRESS", body: "x" })).status).toBe(409);
    expect((await w.eng.request("POST", `/api/v1/executive-recommendation-targets/${target}/respond`, { decision: "ACCEPT" })).status).toBe(409);

    // closing: not by the unit, not by another Director while the author is active, yes by the author
    expect((await w.eng.request("POST", `/api/v1/executive-recommendations/${id}/close`, { reason: "done" })).status).toBe(403);
    expect((await w.director.request("POST", `/api/v1/executive-recommendations/${id}/close`, { reason: "done" })).status).toBe(403);
    expect((await w.exec.request("POST", `/api/v1/executive-recommendations/${id}/close`, { reason: "Declined; noted" })).status).toBe(200);
    expect((await w.eng.request("POST", `/api/v1/executive-recommendations/${id}/replies`, { content: "late" })).status).toBe(409);
    const history = data(await w.exec.request("GET", `/api/v1/executive-recommendations/${id}/history`));
    expect(history.events.map((e: J) => e.event_type)).toEqual(expect.arrayContaining(["PUBLISHED", "ACKNOWLEDGED", "DECLINED", "CLOSED"]));
  });

  it("never touches operational records, whatever is recommended", async () => {
    const w = await setup();
    const tables = ["weekly_reports", "smart_goals", "tasks", "quarterly_objectives", "key_results", "violations", "governance_sessions", "quarters"];
    const snap = async () => JSON.stringify(await Promise.all(tables.map((t) => q(`select * from ${t} order by id`))));
    const before = await snap();
    const r = data(await w.rec(w.exec, { module: "TASK", title: `Change task statuses ${randomUUID().slice(0, 4)}`, detail: "Set all tasks to done and raise every score to 100" }));
    const t = (data(await w.eng.request("GET", `/api/v1/executive-recommendations/${r.id}`))).targets[0].target_id as string;
    await w.eng.request("POST", `/api/v1/executive-recommendation-targets/${t}/respond`, { decision: "ACCEPT", body: "ok" });
    await w.eng.request("POST", `/api/v1/executive-recommendation-targets/${t}/progress`, { kind: "IMPLEMENTED", body: "done through the goal workflow" });
    await w.exec.request("POST", `/api/v1/executive-recommendations/${r.id}/close`, { reason: "ok" });
    expect(await snap()).toBe(before);
  });

  it("refuses a duplicate recommendation, replays the same key and validates the input", async () => {
    const w = await setup();
    const title = `One-off ${randomUUID().slice(0, 6)}`;
    const k = key();
    const a = await w.rec(w.exec, { title, requestKey: k });
    const b = await w.rec(w.exec, { title, requestKey: k });
    expect(data(b).id).toBe(data(a).id);
    const dup = await w.rec(w.exec, { title, requestKey: key() });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("DUPLICATE_RECOMMENDATION");
    expect((await w.rec(w.exec, { title: "No target", targets: [] })).status).toBe(422);
    expect((await w.rec(w.exec, { title: "Past", responseDue: "2001-01-01" })).status).toBe(422);
    expect((await w.rec(w.exec, { title: "Bad priority", priority: "URGENT" })).status).toBe(422);
  });

  it("keeps a draft private, lets only its author publish it, and freezes a published one", async () => {
    const w = await setup();
    const d = data(await w.rec(w.exec, { publish: false, title: `Draft ${randomUUID().slice(0, 6)}` }));
    expect((await w.director.request("GET", `/api/v1/executive-recommendations/${d.id}`)).status).toBe(404);
    expect((await w.eng.request("GET", `/api/v1/executive-recommendations/${d.id}`)).status).toBe(404);
    expect((await w.director.request("POST", `/api/v1/executive-recommendations/${d.id}/publish`, {})).status).toBeGreaterThanOrEqual(403);
    const edited = await w.exec.request("PATCH", `/api/v1/executive-recommendations/${d.id}`, { title: "Edited draft", detail: "Better", reason: "Why", module: "OTHER", targets: [w.engBu], expectedVersion: d.version });
    expect(edited.status).toBe(200);
    const published = await w.exec.request("POST", `/api/v1/executive-recommendations/${d.id}/publish`, { expectedVersion: data(edited).version });
    expect(published.status).toBe(200);
    const again = await w.exec.request("PATCH", `/api/v1/executive-recommendations/${d.id}`, { title: "Quiet change", detail: "x", reason: "y", module: "OTHER", targets: [w.engBu], expectedVersion: data(published).version });
    expect(again.status).toBe(409);
    expect((await w.exec.request("POST", `/api/v1/executive-recommendations/${d.id}/withdraw`, { reason: "Issued by mistake" })).status).toBe(200);
    expect((await w.director.request("POST", `/api/v1/executive-recommendations/${d.id}/withdraw`, { reason: "no" })).status).toBeGreaterThanOrEqual(403);
  });

  it("addresses several units with separate records", async () => {
    const w = await setup();
    const r = data(await w.rec(w.exec, { targets: [w.engBu, w.salesBu], title: `Both ${randomUUID().slice(0, 6)}` }));
    const full = data(await w.exec.request("GET", `/api/v1/executive-recommendations/${r.id}`));
    expect(full.targets).toHaveLength(2);
    const engOnly = data(await w.eng.request("GET", `/api/v1/executive-recommendations/${r.id}`));
    expect(engOnly.targets).toHaveLength(1);
    const salesTarget = full.targets.find((t: J) => t.business_unit_id === w.salesBu).target_id as string;
    expect((await w.eng.request("POST", `/api/v1/executive-recommendation-targets/${salesTarget}/respond`, { decision: "ACCEPT" })).status).toBe(403);
    expect((await w.sales.request("POST", `/api/v1/executive-recommendation-targets/${salesTarget}/respond`, { decision: "DECLINE", body: "Not for us" })).status).toBe(200);
    const after = data(await w.eng.request("GET", `/api/v1/executive-recommendations/${r.id}`));
    expect(after.targets[0].status).toBe("SUBMITTED");                         // the other unit's answer changed nothing here
  });

  it("filters the register and keeps the filters honest", async () => {
    const w = await setup();
    const t = `Filterable ${randomUUID().slice(0, 6)}`;
    await w.rec(w.exec, { title: t, priority: "CRITICAL" });
    const hit = data(await w.exec.request("GET", `/api/v1/executive-recommendations?q=${encodeURIComponent(t)}&priority=CRITICAL&bu=${w.engBu}`));
    expect(hit.total).toBe(1);
    expect(data(await w.exec.request("GET", `/api/v1/executive-recommendations?q=${encodeURIComponent(t)}&priority=LOW`)).total).toBe(0);
    expect(data(await w.sales.request("GET", `/api/v1/executive-recommendations?q=${encodeURIComponent(t)}`)).total).toBe(0);
    expect(data(await w.eng.request("GET", `/api/v1/executive-recommendations?q=${encodeURIComponent(t)}`)).total).toBe(1);
  });
});

describe("files and exports", () => {
  const form = (bytes: Uint8Array, type: string, name: string) => { const f = new FormData(); f.append("file", new File([bytes as BlobPart], name, { type })); return f; };

  it("refuses a malicious or disguised upload and records nothing", async () => {
    const w = await setup();
    const id = data(await w.comment(w.exec)).id as string;
    const eicar = new TextEncoder().encode("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    const bad = await w.exec.form("POST", `/api/v1/executive-comments/${id}/attachments`, form(eicar, "text/plain", "notes.txt"));
    expect(bad.status).toBe(422);
    expect(bad.json.error.code).toBe("MALWARE_DETECTED");
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0]);
    expect((await w.exec.form("POST", `/api/v1/executive-comments/${id}/attachments`, form(exe, "image/png", "x.png"))).status).toBe(422);
    expect((await w.exec.form("POST", `/api/v1/executive-comments/${id}/attachments`, form(new Uint8Array([1, 2, 3]), "application/x-msdownload", "x.exe"))).status).toBe(422);
    expect((await q("select 1 from eo_attachments where comment_id = $1", [id])).length).toBe(0);
    const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
    const cross = await w.sales.form("POST", `/api/v1/executive-comments/${id}/attachments`, form(pdf, "application/pdf", "a.pdf"));
    expect([403, 404]).toContain(cross.status);
    const ok = await w.exec.form("POST", `/api/v1/executive-comments/${id}/attachments`, form(pdf, "application/pdf", "evidence.pdf"));
    if (ok.status !== 200) {
      // the test stack may run without the storage service: it must fail cleanly and leave nothing listed
      expect(ok.json.error?.code).toBe("STORAGE_ERROR");
      expect((await q("select 1 from eo_attachments where comment_id = $1 and deleted_at is null", [id])).length).toBe(0);
    } else {
      const fid = data(ok).id as string;
      expect((await w.eng.request("GET", `/api/v1/executive-attachments/${fid}`)).status).toBe(200);
      expect((await w.sales.request("GET", `/api/v1/executive-attachments/${fid}`)).status).toBe(404);
    }
  });

  it("exports only what the caller may read, to those who may export, with formulas defused", async () => {
    const w = await setup();
    const t = `=HYPERLINK("http://evil.example","click") ${randomUUID().slice(0, 4)}`;
    await w.comment(w.exec, { title: t, content: "formula title" });
    await w.comment(w.exec, { visibility: "MANAGEMENT", title: "management only secret" });
    const csv = await w.exec.request("GET", "/api/v1/executive-oversight/export?kind=comments&format=csv");
    expect(csv.status).toBe(200);
    expect((csv as unknown as { text: string }).text).not.toMatch(/(^|,|")=HYPERLINK/m);
    expect((csv as unknown as { text: string }).text).toContain("management only secret");
    const lead = await w.eng.request("GET", "/api/v1/executive-oversight/export?kind=comments&format=csv");
    expect(lead.status).toBe(200);
    expect((lead as unknown as { text: string }).text).not.toContain("management only secret");
        expect((await w.presenter.request("GET", "/api/v1/executive-oversight/export?kind=comments&format=csv")).status).toBe(403);
    expect((await w.exec.request("GET", "/api/v1/executive-oversight/export?kind=nope&format=csv")).status).toBe(422);
    expect((await q("select 1 from audit_logs where action = 'EXEC_OVERSIGHT_EXPORTED'")).length).toBeGreaterThanOrEqual(2);
  });

  it("serves the panel context only for what the caller may read", async () => {
    const w = await setup();
    const id = data(await w.comment(w.exec, { content: "Context test", subjectType: "BUSINESS_UNIT", subjectId: w.engBu, module: "BU_PERFORMANCE" })).id as string;
    const ctx = data(await w.eng.request("GET", `/api/v1/executive-oversight/context?subjectType=BUSINESS_UNIT&subjectId=${w.engBu}&bu=${w.engBu}`));
    expect(ctx.comments.some((c: J) => c.id === id)).toBe(true);
    const other = data(await w.sales.request("GET", `/api/v1/executive-oversight/context?subjectType=BUSINESS_UNIT&subjectId=${w.engBu}&bu=${w.engBu}`));
    expect(other.comments.some((c: J) => c.id === id)).toBe(false);
    expect((await w.exec.request("GET", "/api/v1/executive-oversight/context?subjectType=BUSINESS_UNIT")).status).toBe(422);
  });
});
