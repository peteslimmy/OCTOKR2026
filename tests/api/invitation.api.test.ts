/**
 * HTTP-level tests for invitation emails (ADR-117): a new person is emailed a set-up link, the administrator can send it again, and only the right people may.
 * Needs the built app and the seeded test stack (mail goes to files, never to a provider):
 *   node scripts/test-stack.mjs run --seed -- node scripts/run-api-tests.mjs invitation
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { Session, loginAs } from "./session";

const FAKE = "11111111-1111-4111-8111-111111111111";
const MAIL_DIR = path.resolve(process.env.EMAIL_FILE_DIR ?? ".dev-mail");
const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
type Sent = { to: string; subject: string; text: string; html?: string };

async function mailTo(address: string, subjectPart: string): Promise<Sent[]> {
  const names = (await readdir(MAIL_DIR).catch(() => [] as string[])).sort();
  const out: Sent[] = [];
  for (const n of names) { const m = JSON.parse(await readFile(path.join(MAIL_DIR, n), "utf8")) as Sent; if (m.to === address && m.subject.includes(subjectPart)) out.push(m); }
  return out;
}
const linkIn = (m: Sent) => /Set up your account: (\S+)/.exec(m.text)?.[1] ?? "";

describe("invitation emails", () => {
  it("only someone who manages users may send an invitation again", async () => {
    expect((await new Session().request("POST", `/api/v1/users/${FAKE}/invite`)).status).toBe(401);
    for (const email of ["lead.eng@4core.local", "presenter@4core.local", "exec@4core.local", "finance@4core.local"]) {
      const s = await loginAs(email);
      expect((await s.request("POST", `/api/v1/users/${FAKE}/invite`)).status, email).toBe(403);
    }
  });

  it("a new person is emailed their invitation; it can be sent again; someone who already signed in cannot be invited again", async () => {
    const s = await loginAs("admin@4core.local");
    const bus = (await s.request("GET", "/api/v1/business-units")).json.data as { id: string }[];
    const email = `invite-${Date.now()}@4core.local`;
    const created = await s.request("POST", "/api/v1/users", { email, firstName: "Ngozi", lastName: "Invitee", businessUnitId: bus[0].id, roles: ["BU_LEAD"] });
    expect(created.status).toBe(200);
    const data = created.json.data as { id: string; setupLink: string | null; initialPassword: string; invitation: { outcome: string } };
    const db = new Client({ connectionString: DB_URL });
    await db.connect();
    try {
      expect(data.invitation.outcome).toBe("SENT");
      const first = await mailTo(email, "You've been invited to 4Core Weekly OKR");
      expect(first).toHaveLength(1);
      expect(first[0].text).toContain("Dear Ngozi,");
      expect(first[0].text).toContain("valid for 24 hours");
      expect(first[0].html).toContain("<table");
      expect(linkIn(first[0])).toContain("/auth/confirm?token_hash=");
      expect(linkIn(first[0])).toBe(data.setupLink);                       // the administrator gets the same link as a fallback
      const audit = await db.query("select action, new_values from audit_logs where entity_id = $1 and action like 'USER_INVITATION_%'", [data.id]);
      expect(audit.rows.map((r: { action: string }) => r.action)).toEqual(["USER_INVITATION_SENT"]);
      expect(JSON.stringify(audit.rows)).not.toContain("token_hash");     // the link is never written to the audit log

      const again = await s.request("POST", `/api/v1/users/${data.id}/invite`);
      expect(again.status).toBe(200);
      expect((again.json.data as { invitation: { outcome: string } }).invitation.outcome).toBe("SENT");
      const second = await mailTo(email, "You've been invited to 4Core Weekly OKR");
      expect(second).toHaveLength(2);
      expect(linkIn(second[1])).not.toBe(linkIn(second[0]));              // a new link each time

      await db.query("update users set last_login_at = now() where id = $1", [data.id]);
      const late = await s.request("POST", `/api/v1/users/${data.id}/invite`);
      expect(late.status).toBe(422);
      expect(late.json.error?.message).toMatch(/already signed in/i);
      expect((await mailTo(email, "You've been invited to 4Core Weekly OKR")).length).toBe(2);
    } finally {
      await s.request("DELETE", `/api/v1/users/${data.id}/delete`, { reason: "invitation test clean-up" });
      await db.end();
    }
  });
});
