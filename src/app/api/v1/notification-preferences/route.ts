import { z } from "zod";
import { api } from "@/lib/api/handler";
import { dbError } from "@/lib/data/errors";
import { userClient } from "@/lib/supabase/server";

/** The caller's own email preference. Security emails (password, authenticator, break-glass, emergency reversal) are sent regardless. */
export const GET = api({}, async ({ actor }) => {
  const sb = await userClient();
  const { data, error } = await sb.from("notification_preferences").select("email_enabled").eq("user_id", actor.id).maybeSingle();
  if (error) throw dbError(error, "notification preference");
  return { emailEnabled: data?.email_enabled ?? true };
});

export const PUT = api({ body: z.object({ emailEnabled: z.boolean() }) }, async ({ actor, body, rpc }) => {
  await rpc("set_email_preference", { p_actor: actor.id, p_enabled: body.emailEnabled });
  return { emailEnabled: body.emailEnabled };
});
