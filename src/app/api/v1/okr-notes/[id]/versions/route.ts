import { api } from "@/lib/api/handler";
import { getNoteVersions } from "@/lib/data/session-notes";

/** GET /api/v1/okr-notes/{id}/versions — every earlier saved state of a note the caller may read (who wrote it, when, why it was replaced). */
export const GET = api({}, async ({ params }) => getNoteVersions(params.id));
