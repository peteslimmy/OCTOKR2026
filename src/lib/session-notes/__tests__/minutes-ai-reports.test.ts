import { describe, expect, it } from "vitest";
import { buildMinutes } from "../minutes";
import { buildRegisterReport, isRegisterKind } from "../registers-report";
import type { ActionRow, DecisionRow, NoteRow, RiskRow, SessionSummary, Workspace } from "../types";

const note = (over: Partial<NoteRow>): NoteRow => ({
  id: "n1", session_id: "s1", category: "GENERAL_DISCUSSION", title: null, content: "Text", visibility: "SHARED", author_id: "u1", author_name: "Ada", last_edited_by: "u1", last_edited_by_name: "Ada",
  version: 1, status: "ACTIVE", archived_at: null, archive_reason: null, noted_at: "2031-01-09T10:00:00Z", created_at: "2031-01-09T10:00:00Z", updated_at: "2031-01-09T10:00:00Z", links: [], attachments: 0, versions: 0, ...over,
});
const decision = (over: Partial<DecisionRow>): DecisionRow => ({
  id: "d1", reference: "DEC-2031-0001", session_id: "s1", session_reference: "OKS-2031-0001", title: "Daily check", description: "Run it daily", background: null, justification: null, decision_date: "2031-01-09", status: "PROPOSED",
  decided_by: null, decided_by_name: null, decided_at: null, authority_note: null, involved: [], affected_bu_id: null, affected_bu_name: "ENG", expected_outcome: null, follow_up: null, superseded_by_reference: null,
  supersedes_reference: null, status_reason: null, version: 1, created_by: "u1", created_by_name: "Ada", created_at: "2031-01-09T10:00:00Z", links: [], attachments: 0, ...over,
});
const action = (over: Partial<ActionRow>): ActionRow => ({
  id: "a1", reference: "ACT-2031-0001", origin_session_id: "s1", origin_session_reference: "OKS-2031-0001", description: "Investigate", business_unit_id: "b1", business_unit_name: "ENG", assignee_id: "u2", assignee_name: "Bo",
  created_by: "u1", created_by_name: "Ada", priority: "HIGH", assigned_at: "2031-01-09T10:00:00Z", due_date: "2031-01-20", original_due_date: "2031-01-20", extensions: 0, status: "OPEN", progress_note: null, blocked_reason: null,
  completed_at: null, completed_by_name: null, completion_remarks: null, requires_verification: false, evidence_required: false, verification_status: "NOT_REQUIRED", escalated_at: null, escalation_reason: null, version: 1,
  overdue: false, due_soon: false, reviews: 0, assignee_unavailable: false, links: [], attachments: 0, source_note_id: null, source_decision_id: null, ...over,
});
const risk = (over: Partial<RiskRow>): RiskRow => ({
  id: "r1", reference: "RSK-2031-0001", session_id: "s1", session_reference: "OKS-2031-0001", kind: "RISK", title: "API instability", description: "Timeouts", business_unit_id: "b1", business_unit_name: "ENG", category: "TECHNICAL",
  severity: "HIGH", business_impact: null, root_cause: null, mitigation: "Retry", owner_id: null, owner_name: null, target_date: null, status: "OPEN", resolution_note: null, overdue: false, reviews: 0, raised_in_sessions: 1,
  version: 1, created_by_name: "Ada", created_at: "2031-01-09T10:00:00Z", links: [], ...over,
});
const ws = (over: Partial<Workspace> = {}): Workspace => ({
  session: {
    id: "s1", reference: "OKS-2031-0001", title: "ENG weekly review", status: "COMPLETED", version: 3, session_type_id: "t", type_name: "Weekly OKR Review", type_code: "WEEKLY_OKR_REVIEW", session_date: "2031-01-09", starts_at: null, ends_at: null,
    business_unit_id: "b1", business_unit_name: "ENG", quarter_id: "q", quarter_label: "Q1 2031", quarter_status: "ACTIVE", reporting_week_id: "w", week: { id: "w", week_number: 2, week_year: 2031, week_start_at: "2031-01-06T00:00:00Z", status: "OPEN", reporting_state: "NORMAL" },
    attendance_session: null, governance_session_id: null, facilitator_id: "u1", facilitator_name: "Ada", created_by: "u1", created_by_name: "Ada", description: "Weekly look at ENG", agenda: "1. Scores", completed_at: null, completed_by_name: null,
    archived_at: null, archived_from: null, created_at: "2031-01-09T09:00:00Z", updated_at: "2031-01-09T09:00:00Z",
  },
  viewer: { id: "u1", is_facilitator: true, is_creator: true },
  participants: [{ user_id: "u1", name: "Ada", role: "FACILITATOR", removed_at: null }, { user_id: "u2", name: "Bo", role: "BU_LEAD", removed_at: null }, { user_id: "u3", name: "Cy", role: "ATTENDEE", removed_at: "2031-01-09T11:00:00Z" }],
  notes: [
    note({ id: "n1", category: "PERFORMANCE_OBSERVATION", content: "Success rate fell to 91%" }),
    note({ id: "n2", category: "MANAGEMENT_FEEDBACK", content: "Management-only remark", visibility: "MANAGEMENT" }),
    note({ id: "n3", category: "GENERAL_DISCUSSION", content: "Confidential matter", visibility: "CONFIDENTIAL" }),
    note({ id: "n4", category: "GENERAL_DISCUSSION", content: "Archived note", status: "ARCHIVED" }),
    note({ id: "n5", category: "RISK_BLOCKER", content: "The bank API may be flaky" }),
  ],
  decisions: [decision({ status: "APPROVED", decided_by_name: "Ada" }), decision({ id: "d2", reference: "DEC-2031-0002", title: "Maybe hire", description: "Hire a contractor", status: "PROPOSED" })],
  actions: [action({})], risks: [risk({})], reviewed_here: [], minutes: [], attachments: [], events: [], ...over,
});

describe("proposed minutes", () => {
  const md = buildMinutes(ws(), { includeManagement: false, generatedOn: "2031-01-10T08:00:00Z" });
  it("has the twelve headings in order", () => {
    const heads = [...md.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => `${m[1]}. ${m[2]}`);
    expect(heads).toEqual(["1. Session details", "2. Participants", "3. Agenda", "4. Major discussion points", "5. Performance observations", "6. Questions and responses", "7. Management feedback", "8. Decisions reached",
      "9. Action items and owners", "10. Risks and blockers", "11. Outstanding matters", "12. Next steps"]);
  });
  it("never includes confidential or archived notes, and management-only notes only for management minutes", () => {
    expect(md).not.toContain("Confidential matter");
    expect(md).not.toContain("Archived note");
    expect(md).not.toContain("Management-only remark");
    expect(buildMinutes(ws(), { includeManagement: true, generatedOn: "2031-01-10T08:00:00Z" })).toContain("Management-only remark");
    expect(buildMinutes(ws(), { includeManagement: true, generatedOn: "2031-01-10T08:00:00Z" })).not.toContain("Confidential matter");
  });
  it("lists a proposed decision as not formal and an approved one as reached", () => {
    const sec8 = md.split("## 8. Decisions reached")[1].split("## 9.")[0];
    expect(sec8).toMatch(/DEC-2031-0001.*Approved/);
    expect(sec8).toContain("not formal decisions");
    expect(sec8.indexOf("DEC-2031-0001")).toBeLessThan(sec8.indexOf("not formal"));
    expect(sec8.indexOf("DEC-2031-0002")).toBeGreaterThan(sec8.indexOf("not formal"));
  });
  it("keeps an observation about a risk distinct from a formal risk, and lists only current participants", () => {
    const sec10 = md.split("## 10. Risks and blockers")[1].split("## 11.")[0];
    expect(sec10).toContain("RSK-2031-0001");
    expect(sec10).toContain("Observation, not a formal risk");
    expect(md).not.toContain("Cy");
  });
  it("says so when a heading has nothing under it, and adds nothing the records do not hold", () => {
    const empty = buildMinutes(ws({ notes: [], decisions: [], actions: [], risks: [] }), { includeManagement: false, generatedOn: "2031-01-10T08:00:00Z" });
    expect(empty.match(/_Nothing recorded\._/g)?.length).toBeGreaterThanOrEqual(8);
    expect(empty).not.toMatch(/decided|agreed/i.source ? /ACT-|DEC-|RSK-/ : /x/);
  });
});

describe("register reports", () => {
  const base = { generatedAt: "2031-01-25T10:00:00Z", scopeLabel: "ENG", periodLabel: "Q1 2031", params: { buId: "b1" } };
  it("knows its kinds", () => {
    expect(isRegisterKind("decisions")).toBe(true);
    expect(isRegisterKind("everything")).toBe(false);
    expect(isRegisterKind(null)).toBe(false);
  });
  it("counts the overdue actions and the completion rate from the rows it was given", () => {
    const rows = [
      action({ id: "1", status: "COMPLETED", completed_at: "2031-01-18T10:00:00Z" }), action({ id: "2", status: "OPEN", overdue: true, due_date: "2031-01-20" }),
      action({ id: "3", status: "CANCELLED" }), action({ id: "4", status: "COMPLETED", completed_at: "2031-01-25T10:00:00Z" }),
    ];
    const r = buildRegisterReport({ ...base, kind: "action-completion", actions: rows });
    expect(r.summary.find((s) => s.label === "Completion rate")?.value).toBe(66.7);
    expect(r.summary.find((s) => s.label === "Completed on or before the due date")?.value).toBe(50);
    const overdue = buildRegisterReport({ ...base, kind: "overdue-actions", actions: rows });
    expect(overdue.rows).toHaveLength(1);
    expect(overdue.rows[0].daysOver).toBe(5);
    expect(buildRegisterReport({ ...base, kind: "outstanding-actions", actions: rows }).rows).toHaveLength(1);
  });
  it("reports no rate (not zero) when there are no actions", () => {
    const r = buildRegisterReport({ ...base, kind: "action-completion", actions: [] });
    expect(r.summary.find((s) => s.label === "Completion rate")?.value).toBeNull();
    expect(r.dataStatus).toBe("NO_DATA");
  });
  it("describes decisions by status and notes that only approved ones are formal", () => {
    const r = buildRegisterReport({ ...base, kind: "decisions", decisions: [decision({ status: "APPROVED" }), decision({ id: "d2", status: "PROPOSED" })] });
    expect(r.summary.find((s) => s.label === "Approved")?.value).toBe(1);
    expect(r.summary.find((s) => s.label === "Proposed")?.value).toBe(1);
    expect(r.notes.join(" ")).toContain("APPROVED decision is a formal decision");
  });
  it("builds session history and risk registers with the context a reader needs", () => {
    const s: SessionSummary = { id: "s1", reference: "OKS-2031-0001", title: "T", status: "COMPLETED", session_date: "2031-01-09", type_name: "Weekly", business_unit_id: "b1", business_unit_name: "ENG", facilitator_name: "Ada", quarter_label: "Q1 2031",
      week_number: 2, week_year: 2031, reporting_week_id: "w", notes: 3, decisions: 1, open_actions: 2, risks: 1, minutes_status: "DRAFT", snippets: [] };
    const h = buildRegisterReport({ ...base, kind: "bu-history", sessions: [s] });
    expect(h.rows[0]).toMatchObject({ reference: "OKS-2031-0001", week: "Week 2 2031", minutes: "DRAFT" });
    expect(h.summary.find((x) => x.label === "Completed sessions without finalised minutes")?.value).toBe(1);
    const rr = buildRegisterReport({ ...base, kind: "risks", risks: [risk({ raised_in_sessions: 2 })] });
    expect(rr.summary.find((x) => x.label === "Raised in more than one session")?.value).toBe(1);
  });
});
