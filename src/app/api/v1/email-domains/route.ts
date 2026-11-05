import { z } from "zod";
import { api } from "@/lib/api/handler";

/** POST /api/v1/email-domains — the Super Admin approves ({add: true}) or removes a domain. The database refuses anyone else. */
export const POST = api(
  { stepUp: true, body: z.object({ domain: z.string().trim().toLowerCase().min(3).max(120), add: z.boolean() }) },
  async ({ actor, body, rpc }) => { await rpc("save_allowed_domain", { p_actor: actor.id, p_domain: body.domain, p_add: body.add }); return { ok: true }; });
