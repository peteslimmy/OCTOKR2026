import { api } from "@/lib/api/handler";
import { listHolidayRequests } from "@/lib/data/governance";

/** Scoped by RLS: only holders of `quarter.score.amend` see requests. */
export const GET = api({}, async () => listHolidayRequests());
