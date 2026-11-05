import { z } from "zod";
import { api } from "@/lib/api/handler";

/** POST /api/v1/ai/admin/settings { key, value } — changes one 4COREPAL setting (switching the module on or off included). Needs ai.config.manage and a recent second factor; audited with the old and new value. */
export const POST = api({ stepUp: true, body: z.object({ key: z.string().min(1).max(60), value: z.union([z.boolean(), z.number().finite(), z.string().max(60)]) }) }, async ({ actor, body, rpc }) => {
  await rpc("ai_set_setting", { p_actor: actor.id, p_key: body.key, p_value: body.value });
  return { key: body.key, value: body.value };
});
