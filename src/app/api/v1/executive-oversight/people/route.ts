import { api, fail } from "@/lib/api/handler";
import { listPeople } from "@/lib/data/executive-oversight";

/** GET /api/v1/executive-oversight/people?bu= — active people of a unit (names only) for naming a recommended or responsible contact. */
export const GET = api({}, async ({ actor, req }) => {
  const bu = new URL(req.url).searchParams.get("bu");
  if (!bu) throw fail("VALIDATION_ERROR", 422, "Choose a business unit.");
  return listPeople(actor.id, bu);
});
