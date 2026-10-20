import { api } from "@/lib/api/handler";
import { listLateCandidates } from "@/lib/data/governance";

export const GET = api({}, async () => listLateCandidates());
