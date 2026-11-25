import "server-only";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";

// Retiring a Business Unit goal needs the chosen executive's approval (ADR-134). Reads run as the caller; the database decides what each person sees.

export interface RetirementExecutive { id: string; name: string; role: "EXECUTIVE" | "DIRECTOR" }
export interface RetirementRequest {
  id: string; bu_goal_id: string; goal_title: string; goal_code: string | null; business_unit_id: string; unit: string | null; quarter_id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; justification: string; requested_at: string; requested_by: string; requester: string | null;
  executive_id: string; executive: string | null; executive_active: boolean; decided_at: string | null; decision_comment: string | null; decider: string | null;
  mine: boolean; can_decide: boolean;
}

export async function listRetirementExecutives(): Promise<RetirementExecutive[]> {
  const { data, error } = await (await userClient()).rpc("read_bu_goal_retirement_executives");
  if (error) throw dbError(error, "retirement executives");
  return (data as RetirementExecutive[]) ?? [];
}

export async function listRetirements(opts: { quarterId?: string | null; businessUnitId?: string | null; toDecide?: boolean } = {}): Promise<RetirementRequest[]> {
  const { data, error } = await (await userClient()).rpc("read_bu_goal_retirements", { p_quarter: opts.quarterId ?? null, p_bu: opts.businessUnitId ?? null, p_mine_to_decide: opts.toDecide ?? false });
  if (error) throw dbError(error, "goal retirements");
  return (data as RetirementRequest[]) ?? [];
}
