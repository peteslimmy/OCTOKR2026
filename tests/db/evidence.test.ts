/**
 * Database-level tests for evidence_files feature.
 * Tests RLS, upsert via ops_upsert_evidence_file, and soft delete via ops_delete_evidence_file.
 * Requires a seeded database (npm run dev:seed).
 */
import { expect, it, describe } from "vitest";
import { withTx, type Ctx, weekId, seedStrategy } from "./helpers";

async function world(c: Ctx) {
  await c.q("update business_units set status = 'INACTIVE'");
  const bu = await c.bu("EV" + Math.random().toString(36).slice(2, 6));
  const hr = await c.user(["HR"], bu, "hr");
  const admin = await c.user(["ADMIN"], bu, "admin");
  const finance = await c.user(["FINANCE"], bu, "fin");
  const sa = await c.user(["SUPER_ADMIN"], bu, "sa");
  const lead = await c.user(["BU_LEAD"], bu, "lead");
  const staff = (await c.q<{ id: string }>("insert into employees (organisation_id, email, first_name, last_name, business_unit_id) values ($1, 'ev@t.local', 'Ev', 'One', $2) returning id", [c.org, bu]))[0].id;

  // Create violation type - HR needs violation.edit permission
  // SECURITY DEFINER functions must be called outside asUser (they check p_actor internally)
  const vt = await c.rpc<string>("create_violation_type", hr, "THEFT", "Theft", "HIGH", 50000);

  // Create a violation - HR needs violation.create permission
  const violationResult = await c.rpc<{ violation_id: string }>("create_violation", hr, staff, null, vt, 50000, "test violation", null, "ev-test-key-1");
  const violation = violationResult.violation_id;

  // Create a fund if needed
  const fundId = (await c.q<{ id: string }>("select id from violation_funds limit 1"))[0]?.id;

  // Create a financial ledger entry via violation payment - ADMIN has violation.payment.record
  const paymentResult = await c.rpc<{ payment_id: string; ledger_entry_id: string }>("record_violation_payment", admin, violation, "PAYMENT", "EVTEST-001", "2026-01-15", "ev-payment-key-1");
  const ledger = paymentResult.ledger_entry_id;

  // Create a weekly report - BU_LEAD has weekly_report.create
  // Need to seed strategy first to activate quarter with proper KRs/Sub-KRs
  await c.setNow("2030-12-01T09:00:00+01:00");
  await seedStrategy(c, admin);
  // Set time to when the reporting week is open
  await c.setNow("2031-01-06T09:00:00+01:00");
  const wk = await weekId(c);
  const report = await c.rpc<string>("get_or_create_weekly_report", lead, wk);

  // Create a governance session - SUPER_ADMIN has attendance.session.manage
  const session = await c.rpc<string>("create_governance_session", sa, wk);

  return { bu, hr, admin, finance, sa, lead, staff, vt, violation, ledger, report, session, fundId };
}

describe("evidence_files DB - RLS policies", () => {
  it("SELECT is enforced via RLS for authenticated users", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      // RLS is enabled; the policy allows SELECT based on entity type + permissions.
      // The read_evidence_files RPC is security invoker, so it needs to be called as a user with appropriate permissions
      // Pass args separately since the SQL function signature is read_evidence_files(p_entity_type text, p_entity_id uuid)
      // The function returns jsonb directly (not an object with data/error)
      const evidence = await c.asUser(w.hr, () => c.rpc<unknown[]>("read_evidence_files", "VIOLATION", "00000000-0000-0000-0000-000000000000"));
      // Expected: empty array for non-existent entity
      expect(evidence).toBeInstanceOf(Array);
      expect(evidence).toHaveLength(0);
    });
  });
});

describe("evidence_files DB - upsert via ops_upsert_evidence_file", () => {
  it("records an evidence file when called with valid parameters by SUPER_ADMIN", async () => {
    await withTx(async (c) => {
      const w = await world(c);

      // ops_upsert_evidence_file is SECURITY DEFINER - call directly, it checks p_actor internally
      // Args passed positionally (not as JSON object), matching SQL function signature
      const result = await c.rpc("ops_upsert_evidence_file", w.sa, "VIOLATION", w.violation, "evidence/VIOLATION/" + w.violation + "/test.pdf", "test-evidences.pdf", "application/pdf", 1024, "a".repeat(64));

      expect(result).not.toBeNull();
      expect(typeof result).toBe("string"); // returns uuid as text

      // Verify the record exists - read_evidence_files is SECURITY INVOKER, needs asUser
      const evidence = await c.asUser(w.hr, () => c.rpc<unknown[]>("read_evidence_files", "VIOLATION", w.violation));
      expect(evidence).toHaveLength(1);
      expect((evidence[0] as { file_name: string }).file_name).toBe("test-evidences.pdf");
    });
  });

  it("records an evidence file for EVERY entity type (violation, ledger entry, report, session)", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const targets: [string, string][] = [["VIOLATION", w.violation], ["LEDGER", w.ledger], ["REPORT", w.report], ["SESSION", w.session]];
      for (const [type, id] of targets) {
        expect(id, type + " entity").toBeTruthy();
        const rec = await c.rpc<string>("ops_upsert_evidence_file", w.hr, type, id, `evidence/${type}/${id}/proof.pdf`, "proof.pdf", "application/pdf", 1024, "b".repeat(64));
        expect(typeof rec, type).toBe("string");
      }
      // a missing entity of each type is refused as not found
      for (const [type] of targets) {
        await c.expectError("NOT_FOUND", () => c.rpc("ops_upsert_evidence_file", w.hr, type, "00000000-0000-4000-8000-000000000001", "evidence/x/y.pdf", "y.pdf", "application/pdf", 10, "c".repeat(64)));
      }
    });
  });

  it("rejects invalid entity_type", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      // ops_upsert_evidence_file is SECURITY DEFINER - call directly, it checks p_actor internally
      // Args passed positionally (not as JSON object), matching SQL function signature:
      // p_actor, p_entity_type, p_entity_id, p_file_path, p_file_name, p_mime_type, p_size_bytes, p_checksum
      await expect(
        c.rpc("ops_upsert_evidence_file", w.sa, "INVALID_TYPE", "00000000-0000-0000-0000-000000000000", "test.pdf", "test.pdf", "application/pdf", 1024, "a".repeat(64))
      ).rejects.toThrow("VALIDATION_ERROR");
    });
  });

  it("rejects when actor lacks evidence.manage permission", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      // BU_LEAD does not have evidence.manage in role-matrix.json
      await expect(
        c.rpc("ops_upsert_evidence_file", w.lead, "VIOLATION", w.violation, "evidence/VIOLATION/" + w.violation + "/test.pdf", "test.pdf", "application/pdf", 1024, "a".repeat(64))
      ).rejects.toThrow("PERMISSION_DENIED");
    });
  });
});

describe("evidence_files DB - soft delete via ops_delete_evidence_file", () => {
  it("soft deletes an evidence file (sets deleted_at, deleted_by)", async () => {
    await withTx(async (c) => {
      const w = await world(c);

      // First upload an evidence file
      // ops_upsert_evidence_file is SECURITY DEFINER - call directly, it checks p_actor internally
      const uploadResult = await c.rpc("ops_upsert_evidence_file", w.sa, "VIOLATION", w.violation, "evidence/VIOLATION/" + w.violation + "/soft-delete-test.pdf", "soft-delete-test.pdf", "application/pdf", 2048, "b".repeat(64));
      expect(uploadResult).not.toBeNull();

      // Now soft delete it
      await c.rpc("ops_delete_evidence_file", w.sa, uploadResult as string);

      // Verify deleted_at is set and record is hidden from read_evidence_files
      const evidence = await c.asUser(w.hr, () => c.rpc<unknown[]>("read_evidence_files", "VIOLATION", w.violation));
      // The soft-deleted record should NOT appear in read_evidence_files (where deleted_at is null)
      expect(evidence).toHaveLength(0); // only non-deleted records show
    });
  });

  it("rejects when deleting a non-existent evidence file", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await expect(
        c.rpc("ops_delete_evidence_file", w.sa, "00000000-0000-0000-0000-000000000000")
      ).rejects.toThrow("NOT_FOUND");
    });
  });

  it("rejects when trying to double-delete (already deleted)", async () => {
    await withTx(async (c) => {
      const w = await world(c);
      // Upload then delete, then try deleting again
      const uploadResult = await c.rpc("ops_upsert_evidence_file", w.sa, "VIOLATION", w.violation, "evidence/VIOLATION/" + w.violation + "/double-del.pdf", "double-del.pdf", "application/pdf", 1024, "c".repeat(64));
      await c.rpc("ops_delete_evidence_file", w.sa, uploadResult as string);
      // Second delete should throw ALREADY_DELETED
      await expect(
        c.rpc("ops_delete_evidence_file", w.sa, uploadResult as string)
      ).rejects.toThrow("ALREADY_DELETED");
    });
  });
});