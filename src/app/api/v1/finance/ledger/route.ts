import { api } from "@/lib/api/handler";
import { getLedger } from "@/lib/data/governance";

export const GET = api({}, async ({ req }) => getLedger(Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 100), 500)));
