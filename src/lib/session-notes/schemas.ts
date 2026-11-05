import { z } from "zod";

export const uuid = z.string().uuid();
export const links = z.array(z.object({ target_type: z.enum(["ANNUAL_THEME", "QUARTER", "OBJECTIVE", "KEY_RESULT", "SUB_KEY_RESULT", "BU_GOAL", "WEEKLY_GOAL", "TASK", "WEEKLY_REPORT"]), target_id: uuid })).max(30);
export const requestKey = z.string().min(8).max(100);
export const reason = z.string().trim().min(1).max(2000);
export const optText = (max: number) => z.string().trim().max(max).nullish();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const version = z.number().int().min(1);
