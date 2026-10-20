import { api, fail } from "@/lib/api/handler";
import { getStrategyTree } from "@/lib/data";

export const GET = api({}, async ({ params }) => {
  const tree = await getStrategyTree(params.id);
  if (!tree) throw fail("NOT_FOUND", 404, "That record was not found.");
  return tree;
});
