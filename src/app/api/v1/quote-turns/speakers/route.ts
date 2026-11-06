import { api, fail } from "@/lib/api/handler";
import { getQuoteSpeakers } from "@/lib/data/quote-rota";
import { uuid } from "@/lib/session-notes/schemas";

/** GET /api/v1/quote-turns/speakers?bu= — the active members of a unit, for "who said it". Empty unless the caller assigns quotes, or enters them for that unit. */
export const GET = api({}, async ({ req }) => {
  const bu = uuid.safeParse(new URL(req.url).searchParams.get("bu"));
  if (!bu.success) throw fail("VALIDATION_ERROR", 422, "Choose a business unit.");
  return getQuoteSpeakers(bu.data);
});
