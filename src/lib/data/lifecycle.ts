import "server-only";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";

// People lifecycle read models. They run as the signed-in person: people managers read every journey, everyone reads their own.
export interface JourneyEvent {
  id: string; event_type: string; effective_date: string; occurred_at: string; from_bu: string | null; to_bu: string | null; role_code: string | null; role_name: string | null;
  promotion: boolean; reason: string | null; actor: string | null; source: "MANUAL" | "SYSTEM" | "BACKFILL";
}
export interface Journey { employee_id: string; name: string | null; email: string | null; events: JourneyEvent[] }
export interface Movement { id: string; employee_id: string; name: string; event_type: string; effective_date: string; from_bu: string | null; to_bu: string | null; role_name: string | null; promotion: boolean; reason: string | null; actor: string | null }

export async function getJourney(employeeId: string): Promise<Journey> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_employee_journey", { p_employee: employeeId });
  if (error) throw dbError(error, "journey");
  return data as Journey;
}
export async function recentMovements(limit = 20): Promise<Movement[]> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_lifecycle_recent", { p_limit: limit });
  if (error) throw dbError(error, "recent movements");
  return (data ?? []) as Movement[];
}
