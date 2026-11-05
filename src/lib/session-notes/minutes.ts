import { categoryLabel, actionStatusLabel, decisionStatusLabel } from "./constants";
import type { ActionRow, DecisionRow, NoteRow, Outstanding, RiskRow, Workspace } from "./types";

/**
 * Builds the proposed minutes of a session from what was recorded in it. Pure and deterministic: it only arranges the records under the twelve headings,
 * adds nothing, and says plainly what is not formal (a proposed decision is listed as proposed; discussion is never turned into a decision or a commitment).
 * Confidential notes never appear; management-only notes appear only when the caller asks for management minutes.
 */
export interface MinutesOptions { includeManagement: boolean; generatedOn: string; outstanding?: Outstanding }

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");
const time = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }).format(new Date(iso)) : null);
/** A line of text kept on one line, with the characters that would start a new block neutralised. */
const oneLine = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const links = (l: { label: string }[]) => (l.length ? ` _(linked: ${l.map((x) => x.label.replace(/[()_*]/g, "")).join("; ")})_` : "");

export function noteIsMinuted(n: NoteRow, includeManagement: boolean): boolean {
  return n.status === "ACTIVE" && (n.visibility === "SHARED" || (includeManagement && n.visibility === "MANAGEMENT"));
}

function noteBlock(n: NoteRow): string {
  const head = `**${n.title ? oneLine(n.title) : categoryLabel(n.category)}** — ${n.author_name ?? "Unknown"}${links(n.links)}`;
  return `${head}\n\n${n.content.trim()}\n`;
}

function section(title: string, body: string[]): string {
  return `## ${title}\n\n${body.length ? body.join("\n") : "_Nothing recorded._"}\n`;
}

const decisionLine = (d: DecisionRow) =>
  `- **${d.reference} — ${oneLine(d.title)}** (${decisionStatusLabel[d.status]}${d.decided_by_name ? `, by ${d.decided_by_name}` : ""}${d.authority_note ? `, ${oneLine(d.authority_note)}` : ""}): ${oneLine(d.description)}${d.expected_outcome ? ` Expected outcome: ${oneLine(d.expected_outcome)}` : ""}${links(d.links)}`;
const actionLine = (a: ActionRow) =>
  `- **${a.reference}** ${oneLine(a.description)} — owner ${a.assignee_name ?? "unassigned"} (${a.business_unit_name ?? "—"}), due ${a.due_date}, ${a.priority.toLowerCase()} priority, ${actionStatusLabel[a.status].toLowerCase()}${links(a.links)}`;
const riskLine = (r: RiskRow) =>
  `- **${r.reference} — ${oneLine(r.title)}** (${r.kind.toLowerCase()}, ${r.severity.toLowerCase()}, ${r.status.toLowerCase()}): ${oneLine(r.description)}${r.mitigation ? ` Mitigation: ${oneLine(r.mitigation)}` : ""}${r.owner_name ? ` Owner: ${r.owner_name}.` : ""}${links(r.links)}`;

export function buildMinutes(ws: Workspace, opts: MinutesOptions): string {
  const s = ws.session;
  const notes = ws.notes.filter((n) => noteIsMinuted(n, opts.includeManagement));
  const of = (...cats: string[]) => notes.filter((n) => cats.includes(n.category));
  const people = ws.participants.filter((p) => !p.removed_at);
  const when = [day(s.session_date), time(s.starts_at) && time(s.ends_at) ? `${time(s.starts_at)}–${time(s.ends_at)}` : time(s.starts_at)].filter(Boolean).join(", ");

  const details = [
    `- **Reference:** ${s.reference}`,
    `- **Type:** ${s.type_name}`,
    `- **Date and time:** ${when} (Lagos time)`,
    `- **Business unit:** ${s.business_unit_name ?? "Organisation-wide"}`,
    `- **Quarter and week:** ${s.quarter_label ?? "—"}${s.week ? `, week ${s.week.week_number} ${s.week.week_year}` : ", no reporting week"}`,
    `- **Facilitator:** ${s.facilitator_name ?? "—"}`,
    ...(s.description ? [`- **Purpose:** ${oneLine(s.description)}`] : []),
  ];
  const participants = people.map((p) => `- ${p.name ?? "Unknown"} — ${p.role.replace("_", " ").toLowerCase()}`);
  const agenda = s.agenda ? [s.agenda.trim(), ""] : [];

  const discussion = of("GENERAL_DISCUSSION", "CHALLENGE_CONCERN").map(noteBlock);
  const performance = of("PERFORMANCE_OBSERVATION").map(noteBlock);
  const qa = of("QUESTION_RAISED", "BU_RESPONSE").map(noteBlock);
  const feedback = of("MANAGEMENT_FEEDBACK").map(noteBlock);
  const decided = ws.decisions.filter((d) => d.status === "APPROVED" || d.status === "SUPERSEDED").map(decisionLine);
  const proposals = ws.decisions.filter((d) => d.status === "PROPOSED" || d.status === "REJECTED" || d.status === "WITHDRAWN").map(decisionLine);
  const actions = ws.actions.filter((a) => a.status !== "CANCELLED").map(actionLine);
  const risks = [...ws.risks.map(riskLine), ...of("RISK_BLOCKER").map((n) => `- _Observation, not a formal risk:_ ${noteBlock(n).replace(/\n+/g, " ").trim()}`)];

  const carried = ws.reviewed_here.map((c) => {
    const rec = c.record;
    const what = rec ? ("title" in rec ? `${rec.reference} ${oneLine(rec.title)}` : `${rec.reference} ${oneLine(rec.description)}`) : "an item";
    return `- ${what} — ${c.outcome.replace(/_/g, " ").toLowerCase()}${c.remarks ? `: ${oneLine(c.remarks)}` : ""}`;
  });
  const followUps = of("FOLLOW_UP").map(noteBlock);
  const stillOpen = (opts.outstanding?.actions ?? []).map(actionLine);

  const next = [
    ...ws.actions.filter((a) => ["OPEN", "IN_PROGRESS", "BLOCKED"].includes(a.status)).map((a) => `- ${a.assignee_name ?? "Owner"}: ${oneLine(a.description)} (by ${a.due_date})`),
    ...of("RECOMMENDATION").map((n) => `- Recommendation (${n.author_name ?? "—"}): ${oneLine(n.content)}`),
  ];

  return [
    `# Minutes — ${oneLine(s.title)}`,
    "",
    `_Prepared ${day(opts.generatedOn)} from the notes, decisions, actions and risks recorded in the session. Draft until reviewed and finalised by a person._`,
    "",
    section("1. Session details", details),
    section("2. Participants", participants),
    section("3. Agenda", agenda),
    section("4. Major discussion points", discussion),
    section("5. Performance observations", performance),
    section("6. Questions and responses", qa),
    section("7. Management feedback", feedback),
    section("8. Decisions reached", [...decided, ...(proposals.length ? ["", "_Proposed or not carried (not formal decisions):_", ...proposals] : [])]),
    section("9. Action items and owners", actions),
    section("10. Risks and blockers", risks),
    section("11. Outstanding matters", [...carried, ...(stillOpen.length ? ["", "_Other commitments of this unit still open:_", ...stillOpen] : []), ...followUps]),
    section("12. Next steps", next),
  ].join("\n");
}
