import { api } from "@/lib/api/handler";
import { listSessionCorrections } from "@/lib/data/governance";

/** Scoped by the read function and RLS: people who manage sessions or may request or approve corrections. */
export const GET = api({}, async () => listSessionCorrections());
