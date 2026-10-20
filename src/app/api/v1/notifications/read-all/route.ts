import { api } from "@/lib/api/handler";

export const POST = api({}, async ({ actor, rpc }) =>
  rpc("mark_all_notifications_read", { p_user: actor.id }));
