import "server-only";
import { userClient } from "@/lib/supabase/server";
import { dbError } from "./errors";
import type { IntegrationsOverview } from "@/lib/integrations/types";

/** The configured integrations and the catalogue of kinds, read under the caller's own permission. Never contains a secret. */
export async function getIntegrations(): Promise<IntegrationsOverview> {
  const sb = await userClient();
  const { data, error } = await sb.rpc("read_integrations");
  if (error) throw dbError(error, "integrations");
  return data as IntegrationsOverview;
}
