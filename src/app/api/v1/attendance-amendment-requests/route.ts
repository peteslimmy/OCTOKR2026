import { api } from "@/lib/api/handler";
import { listAmendments } from "@/lib/data/governance";

/** Scoped by RLS: requesters see their own requests, approvers/viewers see the queue. */
export const GET = api({}, async ({ req }) => listAmendments(new URL(req.url).searchParams.get("status") ?? undefined));
