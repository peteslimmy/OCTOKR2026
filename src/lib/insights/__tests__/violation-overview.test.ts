import { describe, expect, it } from "vitest";
import { buildViolationOverview, type LedgerFact, type RequestFact, type ViolationFact } from "../violation-overview";

const NOW = "2026-11-20T12:00:00Z";
const daysAgo = (d: number) => new Date(new Date(NOW).getTime() - d * 864e5).toISOString();
let n = 0;
const v = (o: Partial<ViolationFact> = {}): ViolationFact => ({ id: `v${++n}`, employee: "Ada", unit: "Finance", type: "Late to session", criticality: "LOW", fine: 5000, status: "OPEN", createdAt: daysAgo(2), paidAt: null, voidedAt: null, ...o });
const paid = (o: Partial<ViolationFact> = {}) => v({ status: "PAID", paidAt: daysAgo(1), ...o });
const r = (o: Partial<RequestFact> = {}): RequestFact => ({ id: `r${++n}`, amount: 20000, purpose: "OKR Refreshment", status: "SUBMITTED", createdAt: daysAgo(1), decidedAt: null, releasedAt: null, requester: "Hadi", ...o });
const ledger = (type: "CREDIT" | "DEBIT", amount: number, ago: number): LedgerFact => ({ type, amount, createdAt: daysAgo(ago), reference: `ref${++n}` });
const build = (o: Partial<Parameters<typeof buildViolationOverview>[0]> = {}) => buildViolationOverview({ violations: [], requests: [], ledger: [], balance: null, now: NOW, ...o });

describe("violation counts and money", () => {
  it("counts by status, leaves a voided violation out of the money, and works out the collection rate", () => {
    const o = build({ violations: [v({ fine: 4000 }), paid({ fine: 6000 }), paid({ fine: 10000, status: "DEDUCTION_RECORDED" }), v({ status: "VOID", voidedAt: daysAgo(1), fine: 99999 })] });
    expect(o.counts).toMatchObject({ total: 4, open: 1, paid: 2, void: 1 });
    expect(o.money).toEqual({ raised: 20000, collected: 16000, outstanding: 4000, collectionRate: 80 });
  });
  it("ages what is unpaid and finds the oldest", () => {
    const o = build({ violations: [v({ createdAt: daysAgo(3) }), v({ createdAt: daysAgo(10) }), v({ createdAt: daysAgo(45) })] });
    expect(o.ageing).toEqual({ under7: 1, from7to30: 1, over30: 1, oldestDays: 45 });
  });
  it("ranks types and units, and finds people with more than one violation in 90 days", () => {
    const o = build({ violations: [v({ employee: "Ada" }), v({ employee: "Ada", type: "Absent" }), v({ employee: "Bo", unit: "HR" }), v({ employee: "Ada", createdAt: daysAgo(200) })] });
    expect(o.byType[0]).toMatchObject({ name: "Late to session", count: 3 });
    expect(o.byUnit[0].name).toBe("Finance");
    expect(o.repeat).toEqual([{ name: "Ada", unit: "Finance", count: 2 }]);              // the violation from 200 days ago does not count
  });
});

describe("the fund", () => {
  it("shows six months of money in and out, ending this month", () => {
    const o = build({ ledger: [ledger("CREDIT", 5000, 2), ledger("CREDIT", 7000, 40), ledger("DEBIT", 3000, 40)] });
    expect(o.monthly).toHaveLength(6);
    expect(o.monthly[5]).toMatchObject({ month: "2026-11", credit: 5000, debit: 0 });
    expect(o.monthly[4]).toMatchObject({ month: "2026-10", credit: 7000, debit: 3000 });
  });
  it("works out how long the fund lasts at the recent rate of spending", () => {
    const o = build({ balance: 90000, ledger: [ledger("DEBIT", 30000, 30), ledger("DEBIT", 30000, 60), ledger("DEBIT", 30000, 90)] });
    expect(o.avgMonthlyOutflow).toBe(30000);
    expect(o.runwayMonths).toBe(3);
    expect(build({ balance: 90000 }).runwayMonths).toBeNull();                      // nothing spent yet: no rate to go by
  });
  it("measures the queue of requests", () => {
    const o = build({ requests: [r({ createdAt: daysAgo(9) }), r({ status: "UNDER_REVIEW", createdAt: daysAgo(2) }), r({ status: "APPROVED" }), r({ status: "DISBURSED" })] });
    expect(o.queue).toEqual({ waiting: 2, oldestDays: 9, approvedAwaitingRelease: 1 });
  });
});

describe("activity and insights", () => {
  it("merges violations, payments, voids and requests into one feed, newest first", () => {
    const o = build({ violations: [paid({ createdAt: daysAgo(5), paidAt: daysAgo(1) })], requests: [r({ createdAt: daysAgo(3), status: "DISBURSED", decidedAt: daysAgo(2), releasedAt: daysAgo(0.5) })] });
    expect(o.activity.map((a) => a.kind)).toEqual(["release", "payment", "decision", "request", "violation"]);
  });
  it("flags unpaid fines, a low collection rate and a slow queue", () => {
    const o = build({ violations: [v({ createdAt: daysAgo(40) }), v(), v(), paid({ fine: 1000 })], requests: [r({ createdAt: daysAgo(8) })] });
    const text = o.insights.map((i) => i.text).join(" | ");
    expect(text).toContain("more than 30 days old");
    expect(text).toContain("collected");
    expect(text).toContain("waiting for a decision");
    expect(o.insights.some((i) => i.severity === "high")).toBe(true);
  });
  it("flags a rise in violations, a concentration in one unit, and a fund about to run out", () => {
    const thisMonth = Array.from({ length: 6 }, () => v({ createdAt: daysAgo(3) }));
    const lastMonth = Array.from({ length: 3 }, () => v({ createdAt: daysAgo(30), unit: "HR" }));
    const o = build({ violations: [...thisMonth, ...lastMonth], balance: 20000, ledger: [ledger("DEBIT", 30000, 30), ledger("DEBIT", 30000, 60), ledger("DEBIT", 30000, 90)] });
    const text = o.insights.map((i) => i.text).join(" | ");
    expect(text).toContain("Violations are rising");
    expect(text).toContain("accounts for");
    expect(text).toContain("the fund lasts about");
  });
  it("says so when nothing is wrong, and says nothing when there is no data", () => {
    expect(build({ violations: [paid({ employee: "Ada" }), paid({ employee: "Bo" })] }).insights).toEqual([{ severity: "good", text: "Nothing unusual: fines are being collected and requests are being decided." }]);
    expect(build().insights).toEqual([]);
  });
  it("is deterministic", () => {
    const i = { violations: [v(), paid()], requests: [r()], ledger: [ledger("CREDIT", 5000, 3)], balance: 5000 };
    expect(build(i)).toEqual(build(i));
  });
});
