import { api, fail } from "@/lib/api/handler";
import { getRoster } from "@/lib/data/governance";

export const GET = api({}, async ({ params }) => {
  const roster = await getRoster(params.id);
  if (!roster) throw fail("NOT_FOUND", 404, "That record was not found.");
  return roster;
});
