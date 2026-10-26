/**
 * Evidence access by role, over HTTP (audit findings F-002, F-023 and the list-endpoint disclosure found by the generated sweep).
 * One evidence record is seeded for an entity; for every seeded role, listing it and fetching it by id and by path must follow the database
 * policy `read_evidence` (VIOLATION: violation.create/edit/payment.record or finance.ledger.view), using the approved role matrix.
 * Files themselves are not stored (the test stack has no storage service), so a permitted fetch may fail later with a storage error:
 * what is asserted is that a person who may not see the record is told "not found", and a person who may is not.
 *
 *   node scripts/test-stack.mjs run --reset --seed -- node scripts/run-api-tests.mjs evidence-access
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLE_ACCOUNTS, Session, loginAs } from "./session";

const matrix = JSON.parse(readFileSync(path.join(__dirname, "..", "db", "fixtures", "role-matrix.json"), "utf8")) as Record<string, string[]>;
const permsOf = (email: string) => new Set(ROLE_ACCOUNTS[email].flatMap((r) => matrix[r] ?? []));
const MAY_SEE_VIOLATION_EVIDENCE = ["violation.create", "violation.edit", "violation.payment.record", "finance.ledger.view"];
const maySee = (email: string) => MAY_SEE_VIOLATION_EVIDENCE.some((p) => permsOf(email).has(p));

const db = new pg.Client({ connectionString: process.env.DB_URL });
const entityId = randomUUID();
const filePath = `evidence/VIOLATION/${entityId}/seed-proof.pdf`;
let evidenceId = "";

beforeAll(async () => {
  await db.connect();
  const hr = (await db.query("select id from users where email = 'hr@4core.local'")).rows[0].id as string;
  // inserted directly: the upsert function insists on a real violation, which this access test does not need
  evidenceId = (await db.query("insert into evidence_files (entity_type, entity_id, file_path, file_name, mime_type, size_bytes, checksum, uploaded_by) values ('VIOLATION', $1, $2, 'seed-proof.pdf', 'application/pdf', 1234, $3, $4) returning id", [entityId, filePath, "a".repeat(64), hr])).rows[0].id as string;
});
afterAll(async () => { await db.end(); });

describe("evidence access follows the database policy for every role", () => {
  it("the role matrix grants the violation-evidence permissions to some roles and not others (sanity)", () => {
    const allowed = Object.keys(ROLE_ACCOUNTS).filter(maySee);
    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed.length).toBeLessThan(Object.keys(ROLE_ACCOUNTS).length);
  });

  for (const email of Object.keys(ROLE_ACCOUNTS)) {
    it(`${email} (${ROLE_ACCOUNTS[email].join("+")}) ${maySee(email) ? "can" : "cannot"} list, fetch by id and fetch by path`, async () => {
      const s = await loginAs(email);
      const list = await s.request("GET", `/api/v1/evidence?entityType=VIOLATION&entityId=${entityId}`);
      expect(list.status).toBe(200);
      expect((list.json.data as unknown[]).length, "listed files").toBe(maySee(email) ? 1 : 0);

      const byId = await s.request("GET", `/api/v1/evidence/${evidenceId}`);
      const byPath = await s.request("GET", `/api/v1/evidence/download?filePath=${encodeURIComponent(filePath)}`);
      if (maySee(email)) {
        expect(byId.status, "by id").not.toBe(404);
        expect(byPath.status, "by path").not.toBe(404);
      } else {
        expect(byId.status, "by id").toBe(404);
        expect(byPath.status, "by path").toBe(404);
      }
    });
  }

  it("bad input is a validation error, never a server crash", async () => {
    const s = await loginAs("hr@4core.local");
    expect((await s.request("GET", "/api/v1/evidence")).status).toBe(422);
    expect((await s.request("GET", "/api/v1/evidence?entityType=NOPE&entityId=not-a-uuid")).status).toBe(422);
    expect((await s.request("POST", "/api/v1/evidence", { not: "multipart" })).status).toBe(422);
    const anon = new Session();
    expect((await anon.request("GET", `/api/v1/evidence?entityType=VIOLATION&entityId=${entityId}`)).status).toBe(401);
    expect((await anon.request("GET", `/api/v1/evidence/${evidenceId}`)).status).toBe(401);
  });
});
