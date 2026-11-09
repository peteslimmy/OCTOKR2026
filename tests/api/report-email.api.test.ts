/**
 * HTTP-level tests for automated report emails (ADR-115): who may use them, validation, preview, test send, manual send, the once-per-period rule,
 * history and retry. Needs the built app and the seeded test stack (mail goes to files, never to a provider):
 *   node scripts/test-stack.mjs run --seed -- node scripts/run-api-tests.mjs report-email
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Session, loginAs } from "./session";

const FAKE = "11111111-1111-4111-8111-111111111111";
const MAIL_DIR = path.resolve(process.env.EMAIL_FILE_DIR ?? ".dev-mail");
type Person = { id: string; name: string; email: string };
type Sent = { to: string; subject: string; text: string; html?: string };

async function mailTo(address: string, subjectPart: string): Promise<Sent[]> {
  const names = await readdir(MAIL_DIR).catch(() => [] as string[]);
  const out: Sent[] = [];
  for (const n of names) { const m = JSON.parse(await readFile(path.join(MAIL_DIR, n), "utf8")) as Sent; if (m.to === address && m.subject.includes(subjectPart)) out.push(m); }
  return out;
}
const body = (recipientIds: string[], over: Record<string, unknown> = {}) => ({ name: `API weekly ${Date.now()}`, frequency: "WEEKLY", sendWeekday: 1, sendDay: 1, sendTime: "08:00", recipientIds, sections: ["HEADLINES", "RANKING", "ATTENTION"], isActive: true, ...over });

describe("automated report emails", () => {
  it("every route refuses an anonymous caller", async () => {
    const s = new Session();
    expect((await s.request("GET", "/api/v1/report-email/schedules")).status).toBe(401);
    expect((await s.request("POST", "/api/v1/report-email/preview", { frequency: "WEEKLY", sections: ["HEADLINES"] })).status).toBe(401);
    expect((await s.request("GET", "/api/v1/report-email/runs")).status).toBe(401);
  });

  it.each(["lead.eng@4core.local", "hr@4core.local", "finance@4core.local", "presenter@4core.local", "director@4core.local", "exec@4core.local"])("%s has no access to schedules, people, history, preview, test, send or retry", async (email) => {
    const s = await loginAs(email);
    for (const [m, u, b] of [
      ["GET", "/api/v1/report-email/schedules"], ["GET", "/api/v1/report-email/people"], ["GET", "/api/v1/report-email/runs"],
      ["POST", "/api/v1/report-email/preview", { frequency: "WEEKLY", sections: ["HEADLINES"] }], ["POST", "/api/v1/report-email/test", { frequency: "WEEKLY", sections: ["HEADLINES"] }],
      ["POST", "/api/v1/report-email/schedules", body([FAKE])], ["PUT", `/api/v1/report-email/schedules/${FAKE}`, body([FAKE])], ["DELETE", `/api/v1/report-email/schedules/${FAKE}`],
      ["POST", `/api/v1/report-email/schedules/${FAKE}/send`, {}], ["POST", `/api/v1/report-email/runs/${FAKE}/retry`],
    ] as [string, string, unknown?][]) {
      const r = await s.request(m, u, b);
      expect(r.status, `${m} ${u}`).toBe(403);
    }
  });

  it("an Admin sets up a schedule, previews it, tests it, sends it once, sees it in the history and cannot send the same period twice", async () => {
    const s = await loginAs("admin@4core.local");
    const people = (await s.request("GET", "/api/v1/report-email/people")).json.data as Person[];
    expect(people.length).toBeGreaterThan(1);
    const recipient = people.find((p) => p.email === "exec@4core.local") ?? people[0];

    // validation
    expect((await s.request("POST", "/api/v1/report-email/schedules", body([]))).status).toBe(422);
    expect((await s.request("POST", "/api/v1/report-email/schedules", body([recipient.id], { sendTime: "25:99" }))).status).toBe(422);
    expect((await s.request("POST", "/api/v1/report-email/schedules", { ...body([recipient.id]), extra: 1 })).status).toBe(422);
    expect((await s.request("POST", "/api/v1/report-email/schedules", body([FAKE]))).json.error?.code).toBe("VALIDATION_ERROR");        // not a person with an account

    const created = await s.request("POST", "/api/v1/report-email/schedules", body([recipient.id]));
    expect(created.status).toBe(200);
    const id = (created.json.data as { id: string }).id;
    try {
      const list = (await s.request("GET", "/api/v1/report-email/schedules")).json.data as { id: string; nextSendAt: string | null }[];
      expect(list.find((x) => x.id === id)?.nextSendAt).toBeTruthy();

      const pv = await s.request("POST", "/api/v1/report-email/preview", { frequency: "WEEKLY", sections: ["HEADLINES", "RANKING"], name: "Preview" });
      expect(pv.status).toBe(200);
      const p = pv.json.data as { subject: string; html: string; text: string };
      expect(p.subject).toMatch(/^4CORE OKR — Weekly summary · Week \d+/);
      expect(p.html).toContain("<table");
      expect(p.html).not.toMatch(/<script/i);
      expect(p.text.length).toBeGreaterThan(20);

      const t = await s.request("POST", "/api/v1/report-email/test", { frequency: "WEEKLY", sections: ["HEADLINES"], name: "Test" });
      expect(t.status).toBe(200);
      const tested = await mailTo("admin@4core.local", "[Test] 4CORE OKR — Weekly summary");
      expect(tested.length).toBeGreaterThanOrEqual(1);
      expect(tested[tested.length - 1].html).toContain("Test email");

      expect((await s.request("POST", `/api/v1/report-email/schedules/${id}/send`, { periodKey: "2099-W01" })).status).toBe(422);         // has not ended
      expect((await s.request("POST", `/api/v1/report-email/schedules/${id}/send`, { periodKey: "2026-10" })).status).toBe(422);            // not a weekly key
      const before = (await mailTo(recipient.email, "Weekly summary")).length;
      const sent = await s.request("POST", `/api/v1/report-email/schedules/${id}/send`, {});
      expect(sent.status).toBe(200);
      expect(sent.json.data).toMatchObject({ status: "SENT", sent: 1, failed: 0, recipients: 1 });
      const got = await mailTo(recipient.email, "Weekly summary");
      expect(got.length).toBe(before + 1);
      expect(got[got.length - 1].html).toBeTruthy();
      expect(got[got.length - 1].text).toContain("4CORE OKR");

      const again = await s.request("POST", `/api/v1/report-email/schedules/${id}/send`, {});
      expect(again.status).toBe(409);
      expect(again.json.error?.code).toBe("REPORT_EMAIL_ALREADY_SENT");
      expect((await mailTo(recipient.email, "Weekly summary")).length).toBe(before + 1);                                                       // nothing was mailed twice

      const runs = (await s.request("GET", "/api/v1/report-email/runs")).json.data as { id: string; schedule_id: string; status: string; report_email_deliveries: { status: string }[] }[];
      const run = runs.find((r) => r.schedule_id === id)!;
      expect(run).toMatchObject({ status: "SENT" });
      expect(run.report_email_deliveries.map((d) => d.status)).toEqual(["SENT"]);
      const retry = await s.request("POST", `/api/v1/report-email/runs/${run.id}/retry`, undefined);
      expect(retry.status).toBe(200);
      expect(retry.json.data).toMatchObject({ retried: 0 });
      expect((await mailTo(recipient.email, "Weekly summary")).length).toBe(before + 1);
    } finally {
      expect((await s.request("DELETE", `/api/v1/report-email/schedules/${id}`)).status).toBe(200);
    }
  });
});
