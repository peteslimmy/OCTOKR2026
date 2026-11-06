import "server-only";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";

// Read models of the weekly quote rota. Every call runs as the signed-in person (their own row-level security decides what comes back).

export interface QuoteTurn {
  id: string; business_unit_id: string; business_unit_name: string; week_id: string; week_number: number; week_year: number;
  shown_in_week_id: string | null; carried: boolean; status: "ASSIGNED" | "SUBMITTED" | "PRESENTED" | "CANCELLED";
  quote: string | null; speaker_name: string | null; submitted_at: string | null; submitted_by_name: string | null; submitted_for_unit: boolean; presented_at: string | null; version: number;
}
export interface RotaWeek { week_id: string; week_number: number; week_year: number; week_start_at: string; reporting_state: string; session_outcome: string | null; turn: QuoteTurn | null }
export interface Speaker { id: string; name: string }

async function read<T>(fn: string, args: Record<string, unknown>, what: string): Promise<T> {
  const sb = await userClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw dbError(error, what);
  return data as T;
}

export const getQuoteRota = () => read<RotaWeek[]>("read_quote_rota", {}, "quote rota");
export const getMyQuoteTurns = (bu?: string) => read<QuoteTurn[]>("read_my_quote_turns", { p_bu: bu ?? null }, "quote turns");
export const getQuoteTurnsForWeek = (week: string) => read<QuoteTurn[]>("read_quote_turns_for_week", { p_week: week }, "quote turns");
export const getQuoteSpeakers = (bu: string) => read<Speaker[]>("read_quote_speakers", { p_bu: bu }, "speakers");
