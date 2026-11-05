import { describe, expect, it } from "vitest";
import { pseudonymiser } from "../safety";
import { TOOLS, TOOL_NAMES } from "../tools";
import { SESSION_TOOLS } from "../tools/sessions";
import { isError, type Asker, type SessionToolData, type ToolContext, type ToolData } from "../tools/types";
import type { ActionRow, DecisionRow, NoteRow, RiskRow, SessionSummary, Workspace } from "@/lib/session-notes/types";

const asker = (perms: string[], buId: string | null = "b1"): Asker => ({ id: "u1", buId, permissions: new Set(perms) });
const summary: SessionSummary = { id: "s1", reference: "OKS-2026-0001", title: "ENG weekly review", status: "COMPLETED", session_date: "2026-11-04", type_name: "Weekly OKR Review", business_unit_id: "b1", business_unit_name: "Engineering",
  facilitator_name: "Ada", quarter_label: "Q4 2026", week_number: 44, week_year: 2026, reporting_week_id: "w1", notes: 3, decisions: 1, open_actions: 2, risks: 1, minutes_status: "FINALISED", snippets: ["success rate [[fell]] to 91%"] };
const note = (o: Partial<NoteRow>): NoteRow => ({ id: "n", session_id: "s1", category: "PERFORMANCE_OBSERVATION", title: null, content: "Success **fell** <script>alert(1)</script> to 91%", visibility: "SHARED", author_id: "u", author_name: "Ada", last_edited_by: "u", last_edited_by_name: "Ada",
  version: 1, status: "ACTIVE", archived_at: null, archive_reason: null, noted_at: "2026-11-04T10:00:00Z", created_at: "", updated_at: "", links: [], attachments: 0, versions: 0, ...o });
const workspace = { session: { ...summary, type_code: "X", week: { week_number: 44 }, facilitator_name: "Ada", description: null, agenda: null }, participants: [{ user_id: "u", name: "Ada", role: "FACILITATOR", removed_at: null }], notes: [note({})],
  decisions: [{ reference: "DEC-2026-0001", status: "APPROVED", title: "Daily check", description: "Run it daily", decided_by_name: "Ada", decision_date: "2026-11-04", expected_outcome: null, justification: null, affected_bu_name: "Engineering", superseded_by_reference: null, session_id: "s1", session_reference: "OKS-2026-0001" } as unknown as DecisionRow],
  actions: [{ reference: "ACT-2026-0001", status: "BLOCKED", description: "Investigate", assignee_name: "Bo", business_unit_name: "Engineering", due_date: "2026-11-10", overdue: false, progress_note: null, blocked_reason: "Waiting for the bank", origin_session_id: "s1", origin_session_reference: "OKS-2026-0001", priority: "HIGH", completed_at: null, reviews: 0, extensions: 0 } as unknown as ActionRow],
  risks: [{ reference: "RSK-2026-0001", kind: "RISK", severity: "HIGH", status: "OPEN", title: "API", description: "Timeouts", mitigation: null, owner_name: null, created_at: "2026-11-04T10:00:00Z", session_id: "s1", session_reference: "OKS-2026-0001" } as unknown as RiskRow], minutes: [{ revision: 1, status: "FINALISED" }] } as unknown as Workspace;

function ctx(perms: string[], sessions: SessionToolData | undefined, calls: Record<string, unknown>[] = []): ToolContext {
  const data = {
    quarter: async (s?: string) => (s ? { id: "q4", label: "Q4 2026" } : null), units: async () => [{ id: "b1", code: "ENG", name: "Engineering" }, { id: "b2", code: "OPS", name: "Operations" }],
    sessions,
  } as unknown as ToolData;
  void calls;
  return { asker: asker(perms), data, px: pseudonymiser(true) };
}
const fake = (log: Record<string, unknown>[] = []): SessionToolData => ({
  search: async (f) => { log.push({ search: f }); return { total: 1, rows: [summary] }; },
  detail: async (id) => (id === "s1" ? workspace : null),
  actions: async (f) => { log.push({ actions: f }); return workspace.actions; },
  decisions: async (f) => { log.push({ decisions: f }); return workspace.decisions; },
  risks: async (f) => { log.push({ risks: f }); return workspace.risks; },
});
const tool = (n: string) => SESSION_TOOLS.find((t) => t.name === n)!;

describe("the assistant's session tools", () => {
  it("are part of the allow-list the model can ask for", () => {
    for (const n of ["search_session_notes", "get_session_record", "list_session_actions", "list_session_decisions", "list_session_risks"]) expect(TOOL_NAMES).toContain(n);
    expect(TOOLS.length).toBe(9 + SESSION_TOOLS.length);
  });
  it("refuse anyone without session_notes.view, and a data source without session access", async () => {
    for (const t of SESSION_TOOLS) {
      const noPerm = await t.run(ctx(["ai.assistant.use"], fake()), {});
      expect(isError(noPerm) && noPerm.error, t.name).toBe("OUT_OF_SCOPE");
      const noData = await t.run(ctx(["session_notes.view"], undefined), {});
      expect(isError(noData) && noData.error, t.name).toBe("OUT_OF_SCOPE");
    }
  });
  it("search passes the filters through, shows excerpts without markers, hides the unit name behind a placeholder and names the session as the source", async () => {
    const log: Record<string, unknown>[] = [];
    const r = await tool("search_session_notes").run(ctx(["session_notes.view"], fake(log)), { query: "success rate", unit: "ENG", quarter: "Q4 2026", status: "COMPLETED" });
    expect(isError(r)).toBe(false);
    if (isError(r)) return;
    expect(log[0]).toEqual({ search: expect.objectContaining({ q: "success rate", bu: "b1", quarter: "q4", status: "COMPLETED" }) });
    const json = JSON.stringify(r.data);
    expect(json).toContain("[[BU:ENG]]");
    expect(json).not.toContain("Engineering");
    expect(json).toContain("«fell»");
    expect(r.sources[0]).toMatchObject({ href: "/session-notes/s1", kind: "session" });
  });
  it("search rejects an unknown unit, a bad status and a bad date", async () => {
    const c = ctx(["session_notes.view"], fake());
    expect(isError(await tool("search_session_notes").run(c, { unit: "nowhere" }))).toBe(true);
    expect(isError(await tool("search_session_notes").run(c, { status: "SECRET" }))).toBe(true);
    expect(isError(await tool("search_session_notes").run(c, { from: "yesterday" }))).toBe(true);
  });
  it("get_session_record returns the records, with note text cleaned of markup and tag characters", async () => {
    const r = await tool("get_session_record").run(ctx(["session_notes.view"], fake()), { sessionId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f" });
    expect(isError(r) && r.error).toBe("OUT_OF_SCOPE");                         // an id the person cannot read looks the same as one that does not exist
    const ok = await tool("get_session_record").run(ctx(["session_notes.view"], { ...fake(), detail: async () => workspace }), { sessionId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f" });
    expect(isError(ok)).toBe(false);
    if (isError(ok)) return;
    const json = JSON.stringify(ok.data);
    expect(json).toContain("Success fell");
    expect(json).not.toMatch(/<script|\*\*/);
    expect(json).toContain("Waiting for the bank");
    expect(json).toContain("DEC-2026-0001");
  });
  it("get_session_record finds a session by reference, and requires one of the two", async () => {
    const c = ctx(["session_notes.view"], { ...fake(), search: async () => ({ total: 1, rows: [summary] }), detail: async (id) => (id === "s1" ? workspace : null) });
    expect(isError(await tool("get_session_record").run(c, { reference: "OKS-2026-0001" }))).toBe(false);
    expect(isError(await tool("get_session_record").run(c, {}))).toBe(true);
    expect(isError(await tool("get_session_record").run(c, { reference: "OKS-1" }))).toBe(true);
  });
  it("the register tools filter as asked and 'mine' means the asker, never a name from the model", async () => {
    const log: Record<string, unknown>[] = [];
    const c = ctx(["session_notes.view"], fake(log));
    await tool("list_session_actions").run(c, { overdue: true, mine: true, status: "BLOCKED" });
    await tool("list_session_decisions").run(c, { status: "APPROVED" });
    await tool("list_session_risks").run(c, { openOnly: true, severity: "HIGH" });
    expect(log[0]).toEqual({ actions: expect.objectContaining({ overdue: true, assignee: "u1", status: "BLOCKED" }) });
    expect(log[1]).toEqual({ decisions: expect.objectContaining({ status: "APPROVED" }) });
    expect(log[2]).toEqual({ risks: expect.objectContaining({ openOnly: true, severity: "HIGH" }) });
  });
});
