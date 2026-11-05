import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";
import { listRules } from "@/lib/data/executive-oversight";

/** GET /api/v1/executive-oversight/escalation-rules — the configured reminder and escalation timeline. */
export const GET = api({}, async () => listRules());

/** POST /api/v1/executive-oversight/escalation-rules { stage, days, recipientKind, roleCode?, active? } — executive_oversight.configure. Escalation is communication only; it never changes a compliance status. */
export const POST = api({ body: S.rule }, async ({ actor, body, rpc }) => {
  await rpc("save_eo_escalation_rule", { p_actor: actor.id, p_stage: body.stage, p_days: body.days, p_recipient_kind: body.recipientKind, p_role_code: body.roleCode ?? null, p_active: body.active ?? null });
  return { ok: true };
});
