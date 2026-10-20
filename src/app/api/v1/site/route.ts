import { z } from "zod";
import { api } from "@/lib/api/handler";
import { getSite } from "@/lib/data/site";
import { landingSchema, loginSchema, referencedSlots, resolveSite } from "@/lib/site-content";

export const GET = api({}, async () => getSite());

/** Saves the landing page and sign-in content. Both are validated as a whole; images no longer referenced are removed afterwards. */
export const PUT = api({ body: z.object({ landing: landingSchema, login: loginSchema }) }, async ({ actor, body, rpc }) => {
  await rpc<number>("set_site_content", { p_actor: actor.id, p_landing: body.landing, p_login: body.login });
  await rpc("prune_site_images", { p_actor: actor.id, p_keep: referencedSlots(resolveSite(body)) });
  return getSite();
});
