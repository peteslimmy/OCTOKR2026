import { api } from "@/lib/api/handler";
import { userClient } from "@/lib/supabase/server";
import { dbError } from "@/lib/data/errors";

/** Owner-only: RLS plus a column grant limit the update to read_at on the caller's own row. */
export const POST = api({}, async ({ params }) => {
  const sb = await userClient();
  const { error } = await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", params.id).is("read_at", null);
  if (error) throw dbError(error, "notification read");
  return { ok: true };
});
