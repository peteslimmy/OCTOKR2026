/**
 * HTTP-level authorisation for changing a unit's type (ADR-114). Needs the built app and the seeded test stack:
 *   node scripts/test-stack.mjs run --seed -- node scripts/run-api-tests.mjs unit-type
 * Non-Super-Admin roles are only refused; the Super Admin change is reverted at the end.
 */
import { describe, expect, it } from "vitest";
import { Session, loginAs } from "./session";

const FAKE = "11111111-1111-4111-8111-111111111111";
const body = { unitType: "DEPARTMENT", reason: "test" };
type Unit = { id: string; name: string; status: string; reports_weekly: boolean; unit_type: string };

describe("POST /api/v1/business-units/[id]/type", () => {
  it("is refused without a session", async () => {
    const r = await new Session().request("POST", `/api/v1/business-units/${FAKE}/type`, body);
    expect(r.status).toBe(401);
  });

  it.each(["admin@4core.local", "hr@4core.local", "lead.eng@4core.local", "director@4core.local", "exec@4core.local"])("%s is refused (403 PERMISSION_DENIED), even for a real unit", async (email) => {
    const s = await loginAs(email);
    const units = (await s.request("GET", "/api/v1/business-units")).json.data as Unit[] | undefined;
    const r = await s.request("POST", `/api/v1/business-units/${units?.[0]?.id ?? FAKE}/type`, body);
    expect(r.status).toBe(403);
    expect(r.json.error?.code).toBe("PERMISSION_DENIED");
  });

  it("Admin cannot change the type through the general PATCH either", async () => {
    const s = await loginAs("admin@4core.local");
    const u = ((await s.request("GET", "/api/v1/business-units")).json.data as Unit[])[0];
    const other = u.unit_type === "DEPARTMENT" ? "BUSINESS_UNIT" : "DEPARTMENT";
    const r = await s.request("PATCH", `/api/v1/business-units/${u.id}`, { name: u.name, status: u.status, reportsWeekly: u.reports_weekly, unitType: other, reason: "x" });
    expect(r.status).toBe(422);
    expect(r.json.error?.code).toBe("USE_TYPE_CHANGE");
  });

  it("rejects unknown fields, an invalid type, a blank reason and an unknown unit for the Super Admin", async () => {
    const s = await loginAs("superadmin@4core.local");
    expect((await s.request("POST", `/api/v1/business-units/${FAKE}/type`, { ...body, status: "INACTIVE" })).status).toBe(422);
    expect((await s.request("POST", `/api/v1/business-units/${FAKE}/type`, { unitType: "DIVISION", reason: "x" })).status).toBe(422);
    expect((await s.request("POST", `/api/v1/business-units/${FAKE}/type`, { unitType: "DEPARTMENT", reason: " " })).status).toBe(422);
    expect((await s.request("POST", `/api/v1/business-units/${FAKE}/type`, body)).status).toBe(404);
  });

  it("the Super Admin can change a unit both ways", async () => {
    const s = await loginAs("superadmin@4core.local");
    const u = ((await s.request("GET", "/api/v1/business-units")).json.data as Unit[])[0];
    const other = u.unit_type === "DEPARTMENT" ? "BUSINESS_UNIT" : "DEPARTMENT";
    expect((await s.request("POST", `/api/v1/business-units/${u.id}/type`, { unitType: other, reason: "api test" })).status).toBe(200);
    expect((await s.request("POST", `/api/v1/business-units/${u.id}/type`, { unitType: u.unit_type, reason: "api test revert" })).status).toBe(200);
  });
});
