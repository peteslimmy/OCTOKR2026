import { describe, expect, it } from "vitest";
import { accessReview, capabilityStatus, conflictsHeld, effectiveAccess, type RoleLite, type ReviewUser } from "../access";

const role = (code: string, name: string, permissions: string[], requiresMfa = false): RoleLite => ({ code, name, permissions, requiresMfa });
const BU = role("BU_LEAD", "BU Lead", ["weekly_report.view_own_bu", "weekly_report.create", "weekly_report.submit", "goal.create", "task.execute"]);
const HR = role("HR", "HR", ["violation.create", "attendance.session.manage", "attendance.record", "attendance.amendment.request", "disbursement.create"]);
const FIN = role("FINANCE", "Finance", ["disbursement.approve", "disbursement.disburse"], true);
const roles = [BU, HR, FIN];
const map = new Map(roles.map((r) => [r.code, r]));
const now = new Date("2026-11-01T00:00:00Z");

describe("effective access", () => {
  it("combines roles and unexpired direct grants, and says where each permission comes from", () => {
    const e = effectiveAccess(["BU_LEAD"], map, [{ permission: "violation.create", reason: "cover", expiresAt: "2026-11-30T00:00:00Z", grantedBy: null }], now);
    expect(e.get("goal.create")?.[0]).toMatchObject({ kind: "role", label: "BU Lead" });
    expect(e.get("violation.create")?.[0]).toMatchObject({ kind: "grant" });
  });
  it("ignores an expired grant, and counts a permission held two ways once with both sources", () => {
    const e = effectiveAccess(["BU_LEAD", "HR"], map, [{ permission: "violation.create", reason: "x", expiresAt: "2026-10-01T00:00:00Z", grantedBy: null }, { permission: "task.execute", reason: "x", expiresAt: null, grantedBy: null }], now);
    expect(e.get("violation.create")).toHaveLength(1);             // only the HR role: the grant has expired
    expect(e.get("task.execute")).toHaveLength(2);                  // the BU Lead role and a direct grant
  });
});

describe("capabilities: why can't I see it?", () => {
  const status = (held: string[]) => capabilityStatus(new Set(held), roles);
  const byId = (s: ReturnType<typeof status>, id: string) => s.find((x) => x.capability.id === id)!;

  it("shows what a BU Lead can and cannot do, and which role would add what is missing", () => {
    const s = status(BU.permissions);
    expect(byId(s, "weekly.file").allowed).toBe(true);
    const violation = byId(s, "violation.report");
    expect(violation.allowed).toBe(false);
    expect(violation.missing).toEqual(["violation.create"]);
    expect(violation.grantedByRoles).toEqual(["HR"]);
    expect(byId(s, "attendance.run").grantedByRoles).toEqual(["HR"]);
  });
  it("gives the BU Lead the HR functions once the HR role is added", () => {
    const s = status([...BU.permissions, ...HR.permissions]);
    for (const id of ["violation.report", "attendance.run", "attendance.skip", "attendance.amend.request", "finance.request"]) expect(byId(s, id).allowed).toBe(true);
    expect(byId(s, "finance.approve").allowed).toBe(false);
  });
  it("treats any-of requirements correctly", () => {
    expect(byId(status(["disbursement.reject"]), "finance.approve").allowed).toBe(true);
    expect(byId(status([]), "finance.approve").allowed).toBe(false);
  });
});

describe("access review", () => {
  const risk = new Map<string, "low" | "medium" | "high" | "critical">([["disbursement.approve", "critical"], ["disbursement.disburse", "critical"], ["violation.create", "medium"], ["disbursement.create", "medium"]]);
  const user = (o: Partial<ReviewUser>): ReviewUser => ({ id: "u", name: "Ada", email: "a@x", unit: null, status: "ACTIVE", roles: ["BU_LEAD"], lastLoginAt: "2026-10-30T00:00:00Z", grants: [], ...o });
  const review = (users: ReviewUser[]) => accessReview({ users, roles, risk, conflicts: [{ a: "disbursement.create", b: "disbursement.approve", reason: "ask and approve" }], now });
  const ids = (f: ReturnType<typeof review>) => f.map((x) => x.id);

  it("flags critical access that is dormant or has no second factor", () => {
    const f = review([user({ id: "f", name: "Fola", roles: ["FINANCE"], lastLoginAt: "2026-08-01T00:00:00Z" }), user({ id: "h", name: "Hadi", roles: ["HR"], grants: [] })]);
    expect(ids(f)).toContain("dormant");
    expect(ids(f)).not.toContain("no-mfa");             // Finance requires an authenticator
    const noMfa = review([user({ id: "x", name: "Xan", roles: ["BU_LEAD"], grants: [{ permission: "disbursement.approve", reason: null, expiresAt: null, grantedBy: null }] })]);
    expect(ids(noMfa)).toContain("no-mfa");
  });
  it("finds a conflict of duties held by one person, open-ended grants and grants about to end", () => {
    const f = review([
      user({ id: "a", name: "Ada", roles: ["HR", "FINANCE"] }),
      user({ id: "b", name: "Bo", grants: [{ permission: "violation.create", reason: "cover", expiresAt: null, grantedBy: null }] }),
      user({ id: "c", name: "Cy", grants: [{ permission: "violation.create", reason: "cover", expiresAt: "2026-11-08T00:00:00Z", grantedBy: null }] }),
    ]);
    expect(ids(f)).toEqual(expect.arrayContaining(["sod", "open-grants", "expiring", "multi-role"]));
    expect(f.find((x) => x.id === "sod")!.userIds).toEqual(["a"]);
  });
  it("ignores inactive accounts", () => {
    expect(review([user({ roles: ["FINANCE"], status: "SUSPENDED", lastLoginAt: null })]).filter((x) => x.id === "dormant")).toEqual([]);
  });
  it("reports conflicts between held permissions", () => {
    expect(conflictsHeld(new Set(["a", "b"]), [{ a: "a", b: "b", reason: "r" }, { a: "a", b: "c", reason: "r" }])).toHaveLength(1);
  });
});
