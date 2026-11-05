import { api } from "@/lib/api/handler";
import { getPeople } from "@/lib/data/session-notes";

/** GET /api/v1/okr-people — active people (name and unit) who can be invited, assigned or made owners. Needs a session permission. */
export const GET = api({}, async () => getPeople());
