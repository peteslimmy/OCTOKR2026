import { api } from "@/lib/api/handler";
import { z } from "zod";
import { userClient } from "@/lib/supabase/server";

export const POST = api({ body: z.object({ email: z.string().trim().email().max(200), firstName: z.string().trim().min(1).max(500), lastName: z.string().trim().min(1).max(500), businessUnitId: z.string().uuid() }) }, async ({ actor, body, rpc }) =>
  rpc("create_employee", { p_actor: actor.id, p_email: body.email, p_first: body.firstName, p_last: body.lastName, p_bu: body.businessUnitId }));

export const GET = api({}, async () => {
  const sb = await userClient();
  const { data, error } = await sb.from("employees").select("id, email, first_name, last_name, employment_status, business_unit_id, business_units(name)").order("last_name");
  if (error) throw new Error(error.message);
  return data;
});
