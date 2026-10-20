import { api } from "@/lib/api/handler";
import { currentQuarter, getStrategyTree } from "@/lib/data";

export const GET = api({}, async () => {
  const q = await currentQuarter();
  return q ? getStrategyTree(q.id) : null;
});
