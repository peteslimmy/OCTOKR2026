import "server-only";
import { userClient } from "@/lib/supabase/server";

export interface AiModuleStatus { enabled: boolean; canUse: boolean }

/** Whether 4COREPAL is switched on and the signed-in person may use any part of it. Never throws: if it cannot be read, the module is simply not offered. */
export async function aiModuleStatus(): Promise<AiModuleStatus> {
  try {
    const sb = await userClient();
    const { data, error } = await sb.rpc("read_ai_status");
    if (error || !data) return { enabled: false, canUse: false };
    const d = data as { enabled?: boolean; canUse?: boolean };
    return { enabled: d.enabled === true, canUse: d.canUse === true };
  } catch { return { enabled: false, canUse: false }; }
}
