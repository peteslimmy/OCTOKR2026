import { describe, expect, it } from "vitest";
import { toDomainError } from "@/lib/domain/errors";
import { notificationAction } from "@/lib/notification-actions";
import { ALLOWED_TAGS, markdownToHtml } from "@/lib/session-notes/markdown";
import { toCsv } from "@/lib/reports/export";
import { eoCaps } from "../caps";
import { EVENT_LABEL, RESPONSES, TARGET_STATUSES, linkTypeLabel, statusLabel } from "../constants";
import { buildOversightReport } from "../report";
import { saveArgs } from "../save-args";
import * as S from "../schemas";
import type { EoComment, EoRecLine } from "../types";

const ID = "6f1c1a52-8b57-4d5c-9a0e-0d8d6f9d3b11";

describe("schemas: an explicit allow-list, never mass assignment", () => {
  const base = { content: "Good week", module: "WEEKLY_REPORT" } as const;

  it("accepts a simple comment and fills the defaults", () => {
    const r = S.createComment.parse(base);
    expect(r.visibility).toBe("SHARED");
    expect(r.links).toEqual([]);
  });

  it("does not know an author, a role or a timestamp (they come from the session)", () => {
    const shape = Object.keys(S.createComment.shape);
    for (const k of ["authorId", "author", "authorRole", "createdAt", "actorId", "status", "reference"]) expect(shape).not.toContain(k);
    const rec = Object.keys(S.saveRecommendation.shape);
    for (const k of ["authorId", "author", "authorRole", "status", "reference", "targetStatus"]) expect(rec).not.toContain(k);
  });

  it("requires a subject type and id together, and bounded text", () => {
    expect(S.createComment.safeParse({ ...base, subjectType: "TASK" }).success).toBe(false);
    expect(S.createComment.safeParse({ ...base, subjectType: "TASK", subjectId: ID }).success).toBe(true);
    expect(S.createComment.safeParse({ ...base, subjectType: "NOT_A_TYPE", subjectId: ID }).success).toBe(false);
    expect(S.createComment.safeParse({ ...base, content: "   " }).success).toBe(false);
    expect(S.createComment.safeParse({ ...base, content: "x".repeat(10001) }).success).toBe(false);
    expect(S.createComment.safeParse({ ...base, requestKey: "short" }).success).toBe(false);
    expect(S.createComment.safeParse({ ...base, module: "SOMETHING" }).success).toBe(false);
  });

  it("limits the links that can be offered to the supported record types", () => {
    expect(S.links.safeParse([{ target_type: "SESSION_NOTE", target_id: ID }]).success).toBe(true);
    expect(S.links.safeParse([{ target_type: "USER", target_id: ID }]).success).toBe(false);
    expect(S.links.safeParse(Array.from({ length: 31 }, () => ({ target_type: "TASK", target_id: ID }))).success).toBe(false);
  });

  it("limits a recommendation to known priorities and at least one addressed unit", () => {
    const rec = { title: "T", detail: "D", module: "OTHER", targets: [ID] };
    expect(S.saveRecommendation.safeParse(rec).success).toBe(true);
    expect(S.saveRecommendation.safeParse({ ...rec, targets: [] }).success).toBe(false);
    expect(S.saveRecommendation.safeParse({ ...rec, priority: "URGENT" }).success).toBe(false);
    expect(S.saveRecommendation.safeParse({ ...rec, responseDue: "20/01/2031" }).success).toBe(false);
    expect(S.saveRecommendation.parse(rec)).toMatchObject({ priority: "NORMAL", publish: false, responseRequested: false });
  });

  it("only allows the six responses a unit can give, and the two progress kinds", () => {
    for (const d of ["ACCEPT", "PARTIAL", "DECLINE", "ALTERNATIVE", "CONSIDERING", "CLARIFICATION"]) expect(S.respond.safeParse({ decision: d }).success).toBe(true);
    expect(S.respond.safeParse({ decision: "APPROVE" }).success).toBe(false);          // there is no way to "approve" a change through this module
    expect(S.respond.safeParse({ decision: "CLOSE" }).success).toBe(false);
    expect(S.progress.safeParse({ kind: "DONE", body: "x" }).success).toBe(false);
    expect(S.progress.safeParse({ kind: "IMPLEMENTED", body: "" }).success).toBe(false);
  });

  it("requires a reason for withdrawing, closing and amending", () => {
    expect(S.withdraw.safeParse({ reason: " " }).success).toBe(false);
    expect(S.closeRec.safeParse({ reason: "" }).success).toBe(false);
    expect(S.amendComment.safeParse({ expectedVersion: 1, reason: "" }).success).toBe(false);
    expect(S.amendComment.safeParse({ reason: "typo" }).success).toBe(false);          // the version you started from is mandatory
  });

  it("keeps configuration inputs tight", () => {
    expect(S.rule.safeParse({ stage: "OVERDUE_SENIOR", days: 10, recipientKind: "ROLE", roleCode: "DIRECTOR" }).success).toBe(true);
    expect(S.rule.safeParse({ stage: "OTHER", days: 10, recipientKind: "AUTHOR" }).success).toBe(false);
    expect(S.rule.safeParse({ stage: "APPROACHING", days: 91, recipientKind: "AUTHOR" }).success).toBe(false);
  });
});

describe("saveArgs: the author is the signed-in person", () => {
  it("always sends the session's actor and nothing the body could spoof", () => {
    const body = S.saveRecommendation.parse({ title: "T", detail: "D", module: "OTHER", targets: [ID], publish: true, requestKey: "request-key-1" });
    const a = saveArgs("actor-from-session", null, body);
    expect(a.p_actor).toBe("actor-from-session");
    expect(a.p_publish).toBe(true);
    expect(a.p_key).toBe("request-key-1");
    expect(Object.keys(a).filter((k) => /author|status/.test(k))).toEqual([]);
  });
});

describe("vocabulary", () => {
  it("labels every lifecycle status, every event the database writes and every link type", () => {
    for (const s of TARGET_STATUSES) expect(statusLabel[s], s).toBeTruthy();
    for (const e of ["CREATED", "REPLY", "AMENDED", "WITHDRAWN", "PUBLISHED", "ACKNOWLEDGED", "ACCEPTED", "PARTIALLY_ACCEPTED", "DECLINED", "ALTERNATIVE_PROPOSED", "UNDER_CONSIDERATION", "CLARIFICATION_REQUESTED",
      "FOLLOW_UP_QUESTION", "MESSAGE", "PROGRESS_REPORTED", "IMPLEMENTATION_REPORTED", "CLOSED", "REASSIGNED", "ESCALATED", "LINK_ADDED", "ATTACHMENT_ADDED"]) expect(EVENT_LABEL[e], e).toBeTruthy();
    for (const t of ["SESSION", "SESSION_NOTE", "SESSION_DECISION", "SESSION_ACTION", "SESSION_RISK", "KEY_RESULT", "WEEKLY_GOAL", "TASK"]) expect(linkTypeLabel(t)).not.toBe(t);
  });

  it("explains a response that needs words, and a decline always does", () => {
    expect(RESPONSES.find((r) => r.value === "DECLINE")?.needs).toBe("required");
    expect(RESPONSES.find((r) => r.value === "PARTIAL")?.needs).toBe("required");
    expect(RESPONSES.find((r) => r.value === "ACCEPT")?.needs).toBe("optional");
  });
});

describe("what each role is offered (the API and the database check again)", () => {
  const perms = (...p: string[]) => ({ id: "u", buId: "b", permissions: new Set(p) });
  it("offers an Executive the author actions and no response actions", () => {
    const c = eoCaps(perms("executive_comment.view", "executive_comment.create", "executive_recommendation.create", "executive_oversight.view_all"));
    expect(c).toMatchObject({ comment: true, recommend: true, viewAll: true, respond: false, progress: false, configure: false });
  });
  it("offers a BU Lead the response actions and none of the author actions", () => {
    const c = eoCaps(perms("executive_comment.view", "executive_comment.reply", "executive_recommendation.respond", "executive_recommendation.update_progress"));
    expect(c).toMatchObject({ respond: true, progress: true, comment: false, recommend: false, close: false, viewAll: false });
  });
  it("offers HR, Finance, Admin and Super Admin nothing to read or write", () => {
    const c = eoCaps(perms("executive_oversight.configure"));
    expect(c).toMatchObject({ viewComments: false, viewRecs: false, comment: false, recommend: false, respond: false, configure: true });
  });
});

describe("errors and notifications", () => {
  it("maps every domain error the module raises to a clear status", () => {
    const expected: Record<string, number> = { DUPLICATE_RECOMMENDATION: 409, COMMENT_WITHDRAWN: 409, RECOMMENDATION_CLOSED: 409, BU_INACTIVE: 409, RECIPIENT_UNAVAILABLE: 409, LINK_TARGET_INVALID: 422, VERSION_CONFLICT: 409,
      INVALID_STATE_TRANSITION: 409, REASON_REQUIRED: 422, BU_SCOPE_DENIED: 403, PERMISSION_DENIED: 403, IDEMPOTENCY_KEY_REUSED: 409, IMMUTABLE_RECORD: 409 };
    for (const [code, status] of Object.entries(expected)) expect(toDomainError({ message: code }), code).toMatchObject({ code, status });
  });
  it("opens the right place from a notification", () => {
    expect(notificationAction("EO_REC_NEW")?.href).toBe("/executive-oversight?tab=recommendations");
    expect(notificationAction("EO_REC_OVERDUE")?.href).toBe("/executive-oversight?tab=recommendations");
    expect(notificationAction("EO_COMMENT_REPLY")?.href).toBe("/executive-oversight?tab=comments");
  });
});

describe("comment text is rendered safely", () => {
  const attacks = ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "[click](javascript:alert(1))", "[x](data:text/html;base64,PHNjcmlwdD4=)", "<svg onload=alert(1)>", "**bold**<iframe src=//evil></iframe>",
    "[a](java\tscript:alert(1))", "<a href=\"javascript:alert(1)\">x</a>", "&lt;script&gt;alert(1)&lt;/script&gt;", "<style>body{display:none}</style>"];
  it.each(attacks)("never lets %s execute", (a) => {
    const html = markdownToHtml(a);
    const tags = [...html.matchAll(/<\/?([a-z][a-z0-9]*)/gi)].map((m) => m[1].toLowerCase());
    expect(tags.filter((t) => !(ALLOWED_TAGS as readonly string[]).includes(t))).toEqual([]);          // only the fixed tag set is ever emitted; typed markup is shown as text
    expect(html).not.toMatch(/href="(javascript|data|vbscript):/i);
    expect(html).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
  });
});

describe("exports", () => {
  const rec = (over: Partial<EoRecLine>): EoRecLine => ({
    id: ID, target_id: ID, reference: "EOR-2031-0001", title: "=HYPERLINK(\"http://evil\",\"x\")", priority: "HIGH", rec_status: "ACTIVE", status: "RESPONSE_REQUESTED", awaiting: "BU", decision: null, overdue: true,
    category_code: null, category: null, author_id: ID, author_name: "Ada Okoye", author_role: "EXECUTIVE", business_unit_id: ID, business_unit_name: "Finance", module: "WEEKLY_REPORT", subject_type: null, subject_id: null, subject_label: null,
    quarter_id: null, quarter: null, reporting_week_id: null, week: null, issued_at: "2031-01-07T10:00:00Z", response_requested: true, response_due: "2031-01-20", responsible_user_id: null, responsible_name: "Bola", responsible_unavailable: false,
    escalation_level: 0, closed_without_response: false, version: 2, target_version: 1, last_activity_at: "2031-01-07T10:00:00Z", latest_update: null, attachments: 0, links: 0, ...over,
  });
  it("builds a register that says it is advice and neutralises spreadsheet formulas", () => {
    const r = buildOversightReport("recommendations", [rec({}), rec({ status: "NOT_ACCEPTED", overdue: false })], { generatedAt: "2031-01-07T10:00:00Z", params: {} });
    expect(r.rows).toHaveLength(2);
    expect(r.notes.join(" ")).toMatch(/advice/);
    expect(r.summary.find((s) => s.label === "Overdue responses")?.value).toBe(1);
    const csv = toCsv(r, "Tester").body.toString("utf8");
    expect(csv).not.toMatch(/(^|,|")=HYPERLINK/m);                            // the leading "=" is defused
  });
  it("builds the comment register", () => {
    const c = { id: ID, reference: "EOC-2031-0001", title: null, summary: "Good week", created_at: "2031-01-07T10:00:00Z", business_unit_name: "Finance", module: "WEEKLY_REPORT", category: null, subject_label: null, author_name: "Ada",
      author_role: "EXECUTIVE", visibility: "MANAGEMENT", status: "PUBLISHED", replies: 2, last_activity_at: "2031-01-08T10:00:00Z" } as unknown as EoComment;
    const r = buildOversightReport("comments", [c], { generatedAt: "2031-01-07T10:00:00Z", params: {} });
    expect(r.rows[0]).toMatchObject({ visibility: "Management only", replies: 2, title: "Good week" });
    expect(buildOversightReport("comments", [], { generatedAt: "x", params: {} }).dataStatus).toBe("NO_DATA");
  });
});
