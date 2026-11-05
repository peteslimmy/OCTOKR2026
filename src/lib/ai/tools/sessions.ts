import { z } from "zod";
import { markdownToText } from "@/lib/session-notes/markdown";
import { categoryLabel } from "@/lib/session-notes/constants";
import { cleanDeep, cleanText } from "../safety";
import type { ToolContext, ToolDef, ToolRun } from "./types";

/**
 * The assistant's way into the OKR Session Notes (ADR-095): what was discussed, decided, committed and flagged in OKR review sessions. Read-only, like every tool.
 * Who may use them: a person with session_notes.view. What they get back is exactly what that person may read in the application: the data underneath is read as the signed-in
 * person, so row-level security already hides other units' sessions, management-only notes from a BU Lead and confidential notes from everyone but their author and the facilitator.
 * Results are cleaned of anything that could pass for an instruction, unit names become placeholders, and every result carries the session it came from.
 */
const out = (message: string, error: "OUT_OF_SCOPE" | "NOT_FOUND" | "NO_DATA" | "INVALID" = "INVALID"): ToolRun => ({ error, message });
const mayRead = (c: ToolContext) => c.asker.permissions.has("session_notes.view") && !!c.data.sessions;
const none = (): ToolRun => out("The session notes are not available to you, or the assistant cannot read them.", "OUT_OF_SCOPE");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const unitArg = z.string().min(1).max(80).optional();
const quarterArg = z.string().max(20).optional();

async function unitId(ctx: ToolContext, spec: string | undefined): Promise<{ id?: string } | { run: ToolRun }> {
  const want = (spec ?? "").trim().toLowerCase();
  if (!want || want === "all") return {};
  const units = await ctx.data.units();
  const hit = want === "mine" || want === "my unit" ? units.find((u) => u.id === ctx.asker.buId) : units.find((u) => u.code.toLowerCase() === want || u.name.toLowerCase() === want) ?? units.find((u) => u.name.toLowerCase().includes(want));
  return hit ? { id: hit.id } : { run: out("No business unit of that name that you may ask about.", "NOT_FOUND") };
}
async function quarterId(ctx: ToolContext, spec: string | undefined): Promise<{ id?: string } | { run: ToolRun }> {
  if (!spec) return {};
  const q = await ctx.data.quarter(spec);
  return q ? { id: q.id } : { run: out("No such quarter.", "NOT_FOUND") };
}
const tokUnit = (ctx: ToolContext, units: { id: string; code: string; name: string }[], name: string | null | undefined) => {
  if (!name) return "organisation-wide";
  const u = units.find((x) => x.name === name);
  return u ? ctx.px.token(u.code, u.name) : cleanText(name, 60);
};
const src = (id: string, label: string, period: string) => ({ label, href: `/session-notes/${id}`, period, kind: "session" as const });
const clip = (md: string, n: number) => cleanText(markdownToText(md), n);

const searchSessions: ToolDef = {
  name: "search_session_notes",
  description: "Find OKR review sessions by what was said in them. Searches note text, decisions, actions and risks you may read, and returns matching sessions with short excerpts. Use it first for any question about discussions, observations, feedback, decisions or commitments.",
  args: "{ query?: \"words to find\", unit?: \"code or name\", quarter?: \"Q4 2026\", from?: \"yyyy-mm-dd\", to?: \"yyyy-mm-dd\", status?: \"DRAFT|IN_PROGRESS|COMPLETED|ARCHIVED\", noteCategory?: \"PERFORMANCE_OBSERVATION|MANAGEMENT_FEEDBACK|RISK_BLOCKER|...\", decisionStatus?: \"APPROVED|PROPOSED|...\", actionStatus?: \"OPEN|BLOCKED|...\" }",
  async run(ctx, raw) {
    const a = z.object({ query: z.string().max(200).optional(), unit: unitArg, quarter: quarterArg, from: date, to: date, status: z.enum(["DRAFT", "IN_PROGRESS", "COMPLETED", "ARCHIVED"]).optional(),
      noteCategory: z.string().max(40).optional(), decisionStatus: z.string().max(20).optional(), actionStatus: z.string().max(20).optional() }).safeParse(raw ?? {});
    if (!a.success) return out("Bad arguments.");
    if (!mayRead(ctx)) return none();
    const u = await unitId(ctx, a.data.unit); if ("run" in u) return u.run;
    const q = await quarterId(ctx, a.data.quarter); if ("run" in q) return q.run;
    const units = await ctx.data.units();
    const r = await ctx.data.sessions!.search({ q: a.data.query, bu: u.id, quarter: q.id, from: a.data.from, to: a.data.to, status: a.data.status, noteCategory: a.data.noteCategory, decisionStatus: a.data.decisionStatus, actionStatus: a.data.actionStatus, limit: 12 });
    return {
      period: "session records",
      data: cleanDeep({ matching: r.total, shown: r.rows.length, sessions: r.rows.map((s) => ({
        sessionId: s.id, reference: s.reference, title: s.title, date: s.session_date, unit: tokUnit(ctx, units, s.business_unit_name), type: s.type_name, status: s.status, quarter: s.quarter_label, week: s.week_number,
        notes: s.notes, decisions: s.decisions, openActions: s.open_actions, risks: s.risks, minutes: s.minutes_status, excerpts: s.snippets.map((x) => x.replace(/\[\[/g, "«").replace(/\]\]/g, "»")),
      })) }, 400),
      sources: r.rows.slice(0, 8).map((s) => src(s.id, `${s.reference} ${s.title}`, s.session_date)),
      limitations: r.total > r.rows.length ? [`Only the first ${r.rows.length} of ${r.total} matching sessions are shown; narrow the question.`] : r.total === 0 ? ["Nothing matched among the sessions you may read. Notes classified for management or as confidential are hidden from people who may not read them."] : [],
    };
  },
};

const getSession: ToolDef = {
  name: "get_session_record",
  description: "Everything recorded in one OKR session you may read: participants, discussion notes (with category and author), decisions with their status, action items with owners and due dates, risks, and the minutes status.",
  args: "{ sessionId?: \"uuid from search_session_notes\", reference?: \"OKS-2026-0001\" }",
  async run(ctx, raw) {
    if (!mayRead(ctx)) return none();
    const a = z.object({ sessionId: z.string().uuid().optional(), reference: z.string().regex(/^OKS-\d{4}-\d{4}$/).optional() }).safeParse(raw ?? {});
    if (!a.success || (!a.data.sessionId && !a.data.reference)) return out("A session id or a reference such as OKS-2026-0001 is required.");
    if (!mayRead(ctx)) return none();
    let id = a.data.sessionId;
    if (!id) {
      const f = await ctx.data.sessions!.search({ q: a.data.reference, limit: 5 });
      id = f.rows.find((s) => s.reference === a.data.reference)?.id;
      if (!id) return out("That session does not exist, or you may not read it.", "OUT_OF_SCOPE");
    }
    const w = await ctx.data.sessions!.detail(id);
    if (!w) return out("That session does not exist, or you may not read it.", "OUT_OF_SCOPE");     // the same answer for both
    const units = await ctx.data.units();
    const s = w.session;
    const notes = w.notes.filter((n) => n.status === "ACTIVE").slice(0, 25);
    return {
      period: s.session_date,
      data: cleanDeep({
        reference: s.reference, title: s.title, date: s.session_date, unit: tokUnit(ctx, units, s.business_unit_name), type: s.type_name, status: s.status, quarter: s.quarter_label, week: s.week?.week_number ?? null,
        facilitator: s.facilitator_name, description: s.description ? clip(s.description, 500) : null, agenda: s.agenda ? clip(s.agenda, 700) : null,
        participants: w.participants.filter((p) => !p.removed_at).map((p) => ({ name: p.name, role: p.role })),
        notes: notes.map((n) => ({ category: categoryLabel(n.category), title: n.title, by: n.author_name, at: n.noted_at.slice(0, 16).replace("T", " "), text: clip(n.content, 700), linkedTo: n.links.map((l) => l.label) })),
        decisions: w.decisions.map((d) => ({ reference: d.reference, status: d.status, title: d.title, decision: clip(d.description, 500), approvedBy: d.decided_by_name, date: d.decision_date, expectedOutcome: d.expected_outcome ? clip(d.expected_outcome, 300) : null })),
        actions: w.actions.map((x) => ({ reference: x.reference, status: x.status, action: clip(x.description, 400), owner: x.assignee_name, unit: tokUnit(ctx, units, x.business_unit_name), due: x.due_date, overdue: x.overdue, progress: x.progress_note ? clip(x.progress_note, 300) : null, blockedBecause: x.blocked_reason })),
        risks: w.risks.map((x) => ({ reference: x.reference, kind: x.kind, severity: x.severity, status: x.status, title: x.title, description: clip(x.description, 400), mitigation: x.mitigation ? clip(x.mitigation, 300) : null, owner: x.owner_name })),
        minutes: w.minutes[0] ? { revision: w.minutes[0].revision, status: w.minutes[0].status } : null,
        notesShown: notes.length, notesTotal: w.notes.filter((n) => n.status === "ACTIVE").length,
      }, 800),
      sources: [src(s.id, `${s.reference} ${s.title}`, s.session_date)],
      limitations: ["This is what you are allowed to read: notes classified for management or as confidential may be missing.", ...(w.notes.filter((n) => n.status === "ACTIVE").length > notes.length ? ["Only the first 25 notes are shown."] : [])],
    };
  },
};

const listActions: ToolDef = {
  name: "list_session_actions",
  description: "Action items (commitments) agreed in OKR sessions: who owns each, when it is due, whether it is overdue or blocked, and the latest progress. Use it for questions about follow-up and accountability.",
  args: "{ unit?: \"code, name or mine\", quarter?: \"Q4 2026\", status?: \"OPEN|IN_PROGRESS|BLOCKED|COMPLETED|CANCELLED\", overdue?: true, mine?: true }",
  async run(ctx, raw) {
    const a = z.object({ unit: unitArg, quarter: quarterArg, status: z.enum(["OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"]).optional(), overdue: z.boolean().optional(), mine: z.boolean().optional() }).safeParse(raw ?? {});
    if (!a.success) return out("Bad arguments.");
    if (!mayRead(ctx)) return none();
    const u = await unitId(ctx, a.data.unit); if ("run" in u) return u.run;
    const q = await quarterId(ctx, a.data.quarter); if ("run" in q) return q.run;
    const units = await ctx.data.units();
    const rows = await ctx.data.sessions!.actions({ bu: u.id, quarter: q.id, status: a.data.status, overdue: a.data.overdue, assignee: a.data.mine ? ctx.asker.id : undefined, limit: 40 });
    return {
      period: "action register",
      data: cleanDeep({ count: rows.length, overdue: rows.filter((x) => x.overdue).length, blocked: rows.filter((x) => x.status === "BLOCKED").length, actions: rows.map((x) => ({
        reference: x.reference, action: clip(x.description, 300), owner: x.assignee_name, unit: tokUnit(ctx, units, x.business_unit_name), priority: x.priority, status: x.status, due: x.due_date, overdue: x.overdue,
        completed: x.completed_at?.slice(0, 10) ?? null, progress: x.progress_note ? clip(x.progress_note, 250) : null, blockedBecause: x.blocked_reason, fromSession: x.origin_session_reference, reviewedInLaterSessions: x.reviews, deadlineMoved: x.extensions })) }, 300),
      sources: [...new Set(rows.map((x) => x.origin_session_id))].slice(0, 8).map((id) => { const x = rows.find((r) => r.origin_session_id === id)!; return src(id, x.origin_session_reference, x.due_date); }),
      limitations: rows.length >= 40 ? ["Only the first 40 are shown; narrow the question."] : [],
    };
  },
};

const listDecisions: ToolDef = {
  name: "list_session_decisions",
  description: "Decisions recorded in OKR sessions with their status. Only APPROVED means a formal decision; PROPOSED was recorded but not approved; SUPERSEDED was replaced by a later one.",
  args: "{ unit?: \"code, name or mine\", quarter?: \"Q4 2026\", status?: \"PROPOSED|APPROVED|REJECTED|SUPERSEDED|WITHDRAWN\", from?: \"yyyy-mm-dd\", to?: \"yyyy-mm-dd\" }",
  async run(ctx, raw) {
    const a = z.object({ unit: unitArg, quarter: quarterArg, status: z.enum(["PROPOSED", "APPROVED", "REJECTED", "SUPERSEDED", "WITHDRAWN"]).optional(), from: date, to: date }).safeParse(raw ?? {});
    if (!a.success) return out("Bad arguments.");
    if (!mayRead(ctx)) return none();
    const u = await unitId(ctx, a.data.unit); if ("run" in u) return u.run;
    const q = await quarterId(ctx, a.data.quarter); if ("run" in q) return q.run;
    const units = await ctx.data.units();
    const rows = await ctx.data.sessions!.decisions({ bu: u.id, quarter: q.id, status: a.data.status, from: a.data.from, to: a.data.to, limit: 40 });
    return {
      period: "decisions register",
      data: cleanDeep({ count: rows.length, decisions: rows.map((d) => ({ reference: d.reference, status: d.status, title: d.title, decision: clip(d.description, 400), reason: d.justification ? clip(d.justification, 250) : null, date: d.decision_date,
        decidedBy: d.decided_by_name, unit: tokUnit(ctx, units, d.affected_bu_name), expectedOutcome: d.expected_outcome ? clip(d.expected_outcome, 250) : null, replacedBy: d.superseded_by_reference, fromSession: d.session_reference })) }, 300),
      sources: [...new Set(rows.map((d) => d.session_id))].slice(0, 8).map((id) => { const d = rows.find((r) => r.session_id === id)!; return src(id, d.session_reference, d.decision_date); }),
      limitations: rows.length >= 40 ? ["Only the first 40 are shown."] : [],
    };
  },
};

const listRisks: ToolDef = {
  name: "list_session_risks",
  description: "Risks, blockers and issues recorded in OKR sessions, with severity, owner, mitigation and how many sessions each was raised in (a sign it keeps recurring).",
  args: "{ unit?: \"code, name or mine\", quarter?: \"Q4 2026\", status?: \"OPEN|MITIGATING|RESOLVED|CLOSED\", severity?: \"LOW|MEDIUM|HIGH|CRITICAL\", openOnly?: true }",
  async run(ctx, raw) {
    const a = z.object({ unit: unitArg, quarter: quarterArg, status: z.enum(["OPEN", "MITIGATING", "RESOLVED", "CLOSED"]).optional(), severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(), openOnly: z.boolean().optional() }).safeParse(raw ?? {});
    if (!a.success) return out("Bad arguments.");
    if (!mayRead(ctx)) return none();
    const u = await unitId(ctx, a.data.unit); if ("run" in u) return u.run;
    const q = await quarterId(ctx, a.data.quarter); if ("run" in q) return q.run;
    const units = await ctx.data.units();
    const rows = await ctx.data.sessions!.risks({ bu: u.id, quarter: q.id, status: a.data.status, severity: a.data.severity, openOnly: a.data.openOnly, limit: 40 });
    return {
      period: "risks register",
      data: cleanDeep({ count: rows.length, risks: rows.map((r) => ({ reference: r.reference, kind: r.kind, severity: r.severity, status: r.status, title: r.title, description: clip(r.description, 300), impact: r.business_impact ? clip(r.business_impact, 250) : null,
        mitigation: r.mitigation ? clip(r.mitigation, 250) : null, owner: r.owner_name, targetDate: r.target_date, unit: tokUnit(ctx, units, r.business_unit_name), raisedInSessions: r.raised_in_sessions, fromSession: r.session_reference })) }, 300),
      sources: [...new Set(rows.map((r) => r.session_id))].slice(0, 8).map((id) => { const r = rows.find((x) => x.session_id === id)!; return src(id, r.session_reference, r.created_at.slice(0, 10)); }),
      limitations: rows.length >= 40 ? ["Only the first 40 are shown."] : [],
    };
  },
};

export const SESSION_TOOLS: readonly ToolDef[] = [searchSessions, getSession, listActions, listDecisions, listRisks];
