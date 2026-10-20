import { api } from "@/lib/api/handler";
import { getFundSummary } from "@/lib/data/governance";

export const GET = api({}, async () => getFundSummary());
