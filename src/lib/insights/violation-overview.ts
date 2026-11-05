// Violations & Funds, read as one story: a rule is broken, a fine is raised, it is paid into the fund, and the fund is spent.
// Fixed rules over what the application already holds; every figure says how it was reached. Nothing here changes anything.

export interface ViolationFact { id: string; employee: string; unit: string; type: string; criticality: string; fine: number; status: "OPEN" | "PAID" | "DEDUCTION_RECORDED" | "VOID"; createdAt: string; paidAt: string | null; voidedAt: string | null }
export interface RequestFact { id: string; amount: number; purpose: string; status: "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "DISBURSED" | "WITHDRAWN"; createdAt: string; decidedAt: string | null; releasedAt: string | null; requester: string | null }
export interface LedgerFact { type: "CREDIT" | "DEBIT"; amount: number; createdAt: string; reference: string }

export type Severity = "high" | "medium" | "low" | "good";
export interface Insight { severity: Severity; text: string }
export interface ActivityItem { at: string; kind: "violation" | "payment" | "void" | "request" | "decision" | "release"; text: string }
export interface Ranked { name: string; count: number; amount: number }
export interface ViolationOverview {
  counts: { total: number; open: number; paid: number; void: number; thisMonth: number; lastMonth: number };
  money: { raised: number; collected: number; outstanding: number; collectionRate: number | null };
  ageing: { under7: number; from7to30: number; over30: number; oldestDays: number | null };
  byType: Ranked[]; byUnit: Ranked[]; byCriticality: Ranked[];
  repeat: { name: string; unit: string; count: number }[];
  monthly: { month: string; label: string; credit: number; debit: number }[];
  runwayMonths: number | null; avgMonthlyOutflow: number | null;
  queue: { waiting: number; oldestDays: number | null; approvedAwaitingRelease: number };
  activity: ActivityItem[]; insights: Insight[];
}

const DAY = 864e5;
const money = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`));
const rank = (rows: { key: string; amount: number }[]): Ranked[] => {
  const m = new Map<string, Ranked>();
  for (const r of rows) { const x = m.get(r.key) ?? { name: r.key, count: 0, amount: 0 }; x.count += 1; x.amount += r.amount; m.set(r.key, x); }
  return [...m.values()].sort((a, b) => b.count - a.count || b.amount - a.amount);
};

export function buildViolationOverview(input: { violations: ViolationFact[]; requests: RequestFact[]; ledger: LedgerFact[]; balance: number | null; now: string }): ViolationOverview {
  const now = new Date(input.now);
  const nowMs = now.getTime();
  const live = input.violations.filter((v) => v.status !== "VOID");
  const open = live.filter((v) => v.status === "OPEN");
  const paid = live.filter((v) => v.status === "PAID" || v.status === "DEDUCTION_RECORDED");
  const thisMonthKey = monthKey(now);
  const lastMonthKey = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const inMonth = (iso: string, key: string) => monthKey(new Date(iso)) === key;

  const raised = live.reduce((n, v) => n + v.fine, 0), collected = paid.reduce((n, v) => n + v.fine, 0), outstanding = open.reduce((n, v) => n + v.fine, 0);
  const ages = open.map((v) => Math.floor((nowMs - new Date(v.createdAt).getTime()) / DAY));
  const ageing = { under7: ages.filter((a) => a < 7).length, from7to30: ages.filter((a) => a >= 7 && a <= 30).length, over30: ages.filter((a) => a > 30).length, oldestDays: ages.length ? Math.max(...ages) : null };

  // repeat offenders: the same person more than once in the last 90 days
  const recent = live.filter((v) => nowMs - new Date(v.createdAt).getTime() <= 90 * DAY);
  const perPerson = new Map<string, { name: string; unit: string; count: number }>();
  for (const v of recent) { const k = `${v.employee}|${v.unit}`; const x = perPerson.get(k) ?? { name: v.employee, unit: v.unit, count: 0 }; x.count += 1; perPerson.set(k, x); }
  const repeat = [...perPerson.values()].filter((p) => p.count >= 2).sort((a, b) => b.count - a.count).slice(0, 5);

  // the fund, month by month (the last six months, including this one)
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) months.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  const monthly = months.map((m) => ({
    month: m, label: monthLabel(m),
    credit: input.ledger.filter((l) => l.type === "CREDIT" && inMonth(l.createdAt, m)).reduce((n, l) => n + l.amount, 0),
    debit: input.ledger.filter((l) => l.type === "DEBIT" && inMonth(l.createdAt, m)).reduce((n, l) => n + l.amount, 0),
  }));
  const lastThree = monthly.slice(2, 5);                                    // the three whole months before this one
  const avgOut = input.ledger.length ? lastThree.reduce((n, m) => n + m.debit, 0) / 3 : null;
  const runway = input.balance !== null && avgOut !== null && avgOut > 0 ? Math.round((input.balance / avgOut) * 10) / 10 : null;

  const waiting = input.requests.filter((r) => r.status === "SUBMITTED" || r.status === "UNDER_REVIEW");
  const waitDays = waiting.map((r) => Math.floor((nowMs - new Date(r.createdAt).getTime()) / DAY));
  const queue = { waiting: waiting.length, oldestDays: waitDays.length ? Math.max(...waitDays) : null, approvedAwaitingRelease: input.requests.filter((r) => r.status === "APPROVED").length };

  const activity: ActivityItem[] = [
    ...input.violations.map((v): ActivityItem => ({ at: v.createdAt, kind: "violation", text: `${v.type} raised against ${v.employee} (${v.unit}): ${money(v.fine)}` })),
    ...input.violations.filter((v) => v.paidAt).map((v): ActivityItem => ({ at: v.paidAt as string, kind: "payment", text: `${v.employee} paid ${money(v.fine)}` })),
    ...input.violations.filter((v) => v.voidedAt).map((v): ActivityItem => ({ at: v.voidedAt as string, kind: "void", text: `${v.type} against ${v.employee} was contested and voided` })),
    ...input.requests.map((r): ActivityItem => ({ at: r.createdAt, kind: "request", text: `${r.requester ?? "Someone"} asked for ${money(r.amount)} for ${r.purpose}` })),
    ...input.requests.filter((r) => r.decidedAt).map((r): ActivityItem => ({ at: r.decidedAt as string, kind: "decision", text: `${money(r.amount)} for ${r.purpose} was ${r.status === "REJECTED" ? "rejected" : "approved"}` })),
    ...input.requests.filter((r) => r.releasedAt).map((r): ActivityItem => ({ at: r.releasedAt as string, kind: "release", text: `${money(r.amount)} released for ${r.purpose}` })),
  ].filter((a) => !Number.isNaN(new Date(a.at).getTime())).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);

  const byType = rank(live.map((v) => ({ key: v.type, amount: v.fine }))).slice(0, 5);
  const byUnit = rank(live.map((v) => ({ key: v.unit, amount: v.fine }))).slice(0, 5);
  const byCriticality = rank(live.map((v) => ({ key: v.criticality.toLowerCase(), amount: v.fine })));
  const thisMonth = live.filter((v) => inMonth(v.createdAt, thisMonthKey)).length, lastMonth = live.filter((v) => inMonth(v.createdAt, lastMonthKey)).length;
  const collectionRate = raised > 0 ? Math.round((collected / raised) * 1000) / 10 : null;

  // ------------------------------------------------------------ insights
  const insights: Insight[] = [];
  if (collectionRate !== null && raised >= 1 && collectionRate < 60 && live.length >= 3) insights.push({ severity: collectionRate < 40 ? "high" : "medium", text: `Only ${collectionRate.toFixed(0)}% of fines raised have been collected: ${money(outstanding)} is outstanding.` });
  if (ageing.over30 > 0) insights.push({ severity: "high", text: `${ageing.over30} unpaid ${ageing.over30 === 1 ? "violation is" : "violations are"} more than 30 days old; the oldest is ${ageing.oldestDays} days.` });
  else if (ageing.from7to30 > 0) insights.push({ severity: "low", text: `${ageing.from7to30} unpaid ${ageing.from7to30 === 1 ? "violation is" : "violations are"} between a week and a month old.` });
  if (lastMonth >= 3 && thisMonth >= lastMonth * 1.5) insights.push({ severity: "medium", text: `Violations are rising: ${thisMonth} this month against ${lastMonth} last month.` });
  else if (lastMonth >= 3 && thisMonth <= lastMonth * 0.5) insights.push({ severity: "good", text: `Violations are falling: ${thisMonth} this month against ${lastMonth} last month.` });
  if (byUnit[0] && live.length >= 6 && byUnit[0].count / live.length > 0.4) insights.push({ severity: "medium", text: `${byUnit[0].name} accounts for ${Math.round((byUnit[0].count / live.length) * 100)}% of all violations.` });
  if (byType[0] && live.length >= 6 && byType[0].count / live.length > 0.5) insights.push({ severity: "low", text: `${byType[0].name} makes up ${Math.round((byType[0].count / live.length) * 100)}% of violations: check whether the rule is clear.` });
  if (repeat.length) insights.push({ severity: "medium", text: `${repeat.length} ${repeat.length === 1 ? "person has" : "people have"} more than one violation in the last 90 days, starting with ${repeat[0].name} (${repeat[0].count}).` });
  const contested = input.violations.length ? input.violations.filter((v) => v.status === "VOID").length / input.violations.length : 0;
  if (input.violations.length >= 8 && contested > 0.25) insights.push({ severity: "medium", text: `${Math.round(contested * 100)}% of violations were contested and voided: check how they are being raised.` });
  if (runway !== null && runway < 3) insights.push({ severity: runway < 1.5 ? "high" : "medium", text: `At the recent rate of spending (${money(avgOut as number)} a month) the fund lasts about ${runway.toFixed(1)} months.` });
  if (queue.oldestDays !== null && queue.oldestDays >= 3) insights.push({ severity: queue.oldestDays >= 7 ? "high" : "medium", text: `${queue.waiting} fund ${queue.waiting === 1 ? "request has" : "requests have"} been waiting for a decision; the oldest for ${queue.oldestDays} days.` });
  if (queue.approvedAwaitingRelease > 0) insights.push({ severity: "low", text: `${queue.approvedAwaitingRelease} approved ${queue.approvedAwaitingRelease === 1 ? "request is" : "requests are"} waiting to be released.` });
  const inNow = monthly[5].credit, inPrev = monthly[4].credit;
  if (inPrev > 0 && inNow < inPrev * 0.5 && now.getUTCDate() >= 20) insights.push({ severity: "low", text: `Money in this month (${money(inNow)}) is well below last month (${money(inPrev)}).` });
  if (!insights.length && input.violations.length + input.requests.length > 0) insights.push({ severity: "good", text: "Nothing unusual: fines are being collected and requests are being decided." });

  return {
    counts: { total: input.violations.length, open: open.length, paid: paid.length, void: input.violations.length - live.length, thisMonth, lastMonth },
    money: { raised, collected, outstanding, collectionRate }, ageing, byType, byUnit, byCriticality, repeat, monthly, runwayMonths: runway, avgMonthlyOutflow: avgOut, queue, activity, insights,
  };
}
