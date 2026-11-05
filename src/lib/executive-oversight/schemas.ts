import { z } from "zod";

export const uuid = z.string().uuid();
export const requestKey = z.string().min(8).max(100);
export const text = (max: number) => z.string().trim().max(max);
export const reqText = (max: number) => z.string().trim().min(1).max(max);
export const optText = (max: number) => z.string().trim().max(max).nullish();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const version = z.number().int().min(1);

export const MODULE = z.enum(["DASHBOARD", "BU_PERFORMANCE", "WEEKLY_REPORT", "PRESENTATION", "STRATEGY", "OBJECTIVE", "KEY_RESULT", "SUB_KEY_RESULT", "GOAL", "TASK", "BU_GOAL", "COMPLIANCE", "RISK", "HISTORICAL_REPORT", "SESSION_NOTES", "OTHER"]);
export const SUBJECT_TYPE = z.enum(["BUSINESS_UNIT", "ANNUAL_THEME", "QUARTER", "OBJECTIVE", "KEY_RESULT", "SUB_KEY_RESULT", "BU_GOAL", "WEEKLY_GOAL", "TASK", "WEEKLY_REPORT", "SESSION", "SESSION_NOTE", "SESSION_DECISION", "SESSION_ACTION", "SESSION_RISK"]);
export const LINK_TYPE = z.enum(["ANNUAL_THEME", "QUARTER", "OBJECTIVE", "KEY_RESULT", "SUB_KEY_RESULT", "BU_GOAL", "WEEKLY_GOAL", "TASK", "WEEKLY_REPORT", "SESSION", "SESSION_NOTE", "SESSION_DECISION", "SESSION_ACTION", "SESSION_RISK"]);
export const links = z.array(z.object({ target_type: LINK_TYPE, target_id: uuid })).max(30);

export const createComment = z.object({
  businessUnitId: uuid.nullish(), category: z.string().max(40).nullish(), title: optText(200), content: reqText(10000), visibility: z.enum(["SHARED", "MANAGEMENT"]).default("SHARED"),
  module: MODULE, subjectType: SUBJECT_TYPE.nullish(), subjectId: uuid.nullish(), quarterId: uuid.nullish(), reportingWeekId: uuid.nullish(), links: links.default([]), requestKey: requestKey.optional(),
}).refine((b) => (b.subjectType == null) === (b.subjectId == null), { message: "A subject needs both a type and an id" });

export const reply = z.object({ content: reqText(10000), requestKey: requestKey.optional() });
export const amendComment = z.object({ expectedVersion: version, category: z.string().max(40).nullish(), title: optText(200), content: text(10000).nullish(), reason: reqText(2000) });
export const withdraw = z.object({ reason: reqText(2000) });

export const saveRecommendation = z.object({
  title: reqText(200), detail: reqText(10000), background: optText(10000), reason: optText(10000), expectedOutcome: optText(5000), proposedDirection: optText(5000),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).default("NORMAL"), category: z.string().max(40).nullish(), module: MODULE, subjectType: SUBJECT_TYPE.nullish(), subjectId: uuid.nullish(),
  quarterId: uuid.nullish(), reportingWeekId: uuid.nullish(), recommendedOwnerRole: optText(100), recommendedOwnerUser: uuid.nullish(), responseRequested: z.boolean().default(false), responseDue: isoDate.nullish(),
  targets: z.array(uuid).min(1).max(30), links: links.default([]), publish: z.boolean().default(false), expectedVersion: version.optional(), requestKey: requestKey.optional(),
}).refine((b) => (b.subjectType == null) === (b.subjectId == null), { message: "A subject needs both a type and an id" });

export const publish = z.object({ expectedVersion: version.optional(), requestKey: requestKey.optional() });
export const closeRec = z.object({ targetId: uuid.nullish(), reason: reqText(2000), requestKey: requestKey.optional() });
export const recMessage = z.object({ targetId: uuid.nullish(), content: reqText(10000), requestKey: requestKey.optional() });

export const acknowledge = z.object({ expectedVersion: version.optional(), requestKey: requestKey.optional() });
export const respond = z.object({ decision: z.enum(["ACCEPT", "PARTIAL", "DECLINE", "ALTERNATIVE", "CONSIDERING", "CLARIFICATION"]), body: text(10000).nullish(), expectedVersion: version.optional(), requestKey: requestKey.optional() });
export const progress = z.object({ kind: z.enum(["PROGRESS", "IMPLEMENTED"]), body: reqText(10000), expectedVersion: version.optional(), requestKey: requestKey.optional() });
export const followUp = z.object({ body: reqText(10000), expectedVersion: version.optional(), requestKey: requestKey.optional() });
export const reassign = z.object({ userId: uuid, reason: reqText(2000) });
export const linkChange = z.object({ targetType: LINK_TYPE, targetId: uuid, remove: z.boolean().default(false) });
export const removeFile = z.object({ reason: reqText(1000) });

export const category = z.object({ id: uuid.nullish(), code: z.string().max(40).nullish(), name: reqText(100), description: optText(500), sortOrder: z.number().int().min(0).max(10000).nullish(), active: z.boolean().nullish() });
export const rule = z.object({ stage: z.enum(["APPROACHING", "OVERDUE_REMINDER", "OVERDUE_MANAGEMENT", "OVERDUE_SENIOR"]), days: z.number().int().min(0).max(90), recipientKind: z.enum(["BU_LEAD", "RESPONSIBLE", "AUTHOR", "ROLE"]), roleCode: z.string().max(40).nullish(), active: z.boolean().nullish() });
