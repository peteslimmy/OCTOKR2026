import { api } from "@/lib/api/handler";
import { listLedgerReversals } from "@/lib/data/governance";

/** Scoped by RLS and the read function: only people who may view the ledger. */
export const GET = api({}, async () => listLedgerReversals());
