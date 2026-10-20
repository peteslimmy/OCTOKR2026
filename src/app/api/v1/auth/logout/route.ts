import { api } from "@/lib/api/handler";
import { userClient } from "@/lib/supabase/server";

export const POST = api({ partial: true }, async ({ actor, rpc }) => {
  await rpc("record_logout", { p_user: actor.id });
  const sb = await userClient();
  await sb.auth.signOut({ scope: "global" });
  return { ok: true };
});
