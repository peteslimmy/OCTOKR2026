import { z } from "zod";
import { FREQUENCIES } from "./periods";
import { ALL_SECTIONS } from "./render";

/** Request bodies for the automated report email API (client-safe). */
export const scheduleBody = z.object({
  name: z.string().trim().min(1, "Give the schedule a name.").max(120),
  frequency: z.enum(FREQUENCIES as [string, ...string[]]),
  sendWeekday: z.number().int().min(1).max(7).default(1),
  sendDay: z.number().int().min(1).max(28).default(1),
  sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 08:00."),
  recipientIds: z.array(z.string().uuid()).min(1, "Choose at least one recipient.").max(50),
  sections: z.array(z.enum(ALL_SECTIONS as [string, ...string[]])).min(1, "Include at least one section."),
  isActive: z.boolean().default(true),
});
export const previewBody = z.object({
  frequency: z.enum(FREQUENCIES as [string, ...string[]]),
  sections: z.array(z.enum(ALL_SECTIONS as [string, ...string[]])).min(1),
  name: z.string().trim().max(120).default("Report summary"),
  periodKey: z.string().max(12).optional(),
});
export const sendBody = z.object({ periodKey: z.string().max(12).optional() });
