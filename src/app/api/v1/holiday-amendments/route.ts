import { api } from "@/lib/api/handler";
import { listHolidayAmendments } from "@/lib/data/governance";

/** Scoped by RLS: only score-amend / holiday-manage holders see the amendment history. */
export const GET = api({}, async () => listHolidayAmendments());
