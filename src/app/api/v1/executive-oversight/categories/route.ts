import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";
import { listCategories } from "@/lib/data/executive-oversight";

/** GET /api/v1/executive-oversight/categories — the comment categories offered. */
export const GET = api({}, async () => listCategories());

/** POST /api/v1/executive-oversight/categories { id?, code?, name, description?, sortOrder?, active? } — executive_oversight.configure (Admin, Super Admin): the list only, never the commentary. */
export const POST = api({ body: S.category }, async ({ actor, body, rpc }) =>
  ({ id: await rpc("save_eo_category", { p_actor: actor.id, p_id: body.id ?? null, p_code: body.code ?? null, p_name: body.name, p_description: body.description ?? null, p_sort: body.sortOrder ?? null, p_active: body.active ?? null }) }));
