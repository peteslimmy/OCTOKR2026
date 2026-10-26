/**
 * Evidence upload and delete over HTTP. Replaces an earlier file whose helper never sent a request body (its sign-in failed with 422 for every
 * test) and whose success case accepted either 200 or 422, so it proved nothing (audit finding F-023).
 *
 * Every case here is decided BEFORE any file reaches storage, so the test stack's missing storage service does not matter: that is also the
 * point of finding F-003 (the record, and with it the permission check, comes first; nobody without the permission can store a file).
 *
 *   node scripts/test-stack.mjs run --reset --seed -- node scripts/run-api-tests.mjs evidence.api
 */
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Session, loginAs } from "./session";

const HR = "hr@4core.local";            // holds evidence.manage
const LEAD = "lead.eng@4core.local";    // does not
const PDF = new TextEncoder().encode("%PDF-1.4 a small, genuine-looking file");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function upload(opts: { bytes?: Uint8Array; type?: string; meta?: Record<string, unknown> | string | null; omitFile?: boolean } = {}) {
  const bytes = opts.bytes ?? PDF;
  const type = opts.type ?? "application/pdf";
  const fd = new FormData();
  if (!opts.omitFile) fd.append("file", new Blob([bytes as BlobPart], { type }), "proof.pdf");
  if (opts.meta !== null) {
    fd.append("metadata", typeof opts.meta === "string" ? opts.meta : JSON.stringify({
      entityType: "VIOLATION", entityId: randomUUID(), fileName: "proof.pdf", mimeType: type, sizeBytes: bytes.length, checksum: sha(bytes), ...(opts.meta ?? {}),
    }));
  }
  return fd;
}

describe("evidence upload validation (all refused before storage)", () => {
  it("refuses an anonymous caller", async () => {
    expect((await new Session().form("POST", "/api/v1/evidence", upload())).status).toBe(401);
  });

  it("answers every kind of bad input with 422, never a server error", async () => {
    const s = await loginAs(HR);
    const cases: [string, FormData][] = [
      ["no file", upload({ omitFile: true })],
      ["no metadata", upload({ meta: null })],
      ["metadata that is not JSON", upload({ meta: "{not json" })],
      ["a type that is not allowed", upload({ type: "application/x-msdownload" })],
      ["an unknown entity type", upload({ meta: { entityType: "NOPE" } })],
      ["an entity id that is not a UUID", upload({ meta: { entityId: "abc" } })],
      ["a declared type that differs from the file's", upload({ meta: { mimeType: "image/png" } })],
      ["HTML dressed up as a PDF", upload({ bytes: new TextEncoder().encode("<html><script>alert(1)</script></html>") })],
      ["a checksum that does not match", upload({ meta: { checksum: "0".repeat(64) } })],
    ];
    for (const [label, fd] of cases) {
      const r = await s.form("POST", "/api/v1/evidence", fd);
      expect(r.status, label).toBe(422);
      expect(r.json.error?.code, label).toBe("VALIDATION_ERROR");
    }
    // not multipart at all
    expect((await s.request("POST", "/api/v1/evidence", { nope: true })).status).toBe(422);
  });
});

describe("evidence upload authorisation comes before storage (F-003)", () => {
  it("a role without evidence.manage is refused with 403 even for a perfect file", async () => {
    const s = await loginAs(LEAD);
    const r = await s.form("POST", "/api/v1/evidence", upload());
    expect(r.status).toBe(403);
    expect(r.json.error?.code).toBe("PERMISSION_DENIED");
  });

  it("a permitted role with a perfect file for an entity that does not exist gets 404 from the database, not a stored file", async () => {
    const s = await loginAs(HR);
    const r = await s.form("POST", "/api/v1/evidence", upload());
    expect(r.status).toBe(404);
    expect(r.json.error?.code).toBe("NOT_FOUND");
  });
});

describe("evidence delete", () => {
  it("refuses an anonymous caller and a role without the permission, and reports an unknown id as not found", async () => {
    const id = randomUUID();
    expect((await new Session().request("DELETE", `/api/v1/evidence/${id}/delete`, {})).status).toBe(401);
    expect((await (await loginAs(LEAD)).request("DELETE", `/api/v1/evidence/${id}/delete`, {})).status).toBe(403);
    expect((await (await loginAs(HR)).request("DELETE", `/api/v1/evidence/${id}/delete`, {})).status).toBe(404);
  });
});
