import { z } from "zod";
import { api } from "@/lib/api/handler";
import { listSessionTypes } from "@/lib/data/session-notes";
import { uuid } from "@/lib/session-notes/schemas";

/** GET /api/v1/okr-session-types — the configurable list of session types. */
export const GET = api({}, async () => listSessionTypes());

/** POST /api/v1/okr-session-types { id?, code, name, description?, sortOrder?, active? } — add or change a type (session_notes.configure: Admin and Super Admin; gives no access to session content). */
export const POST = api({
  body: z.object({ id: uuid.nullish(), code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/).optional(), name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).nullish(), sortOrder: z.number().int().min(0).max(1000).optional(), active: z.boolean().optional() }),
}, async ({ actor, body, rpc }) => ({ id: await rpc<string>("save_okr_session_type", { p_actor: actor.id, p_id: body.id ?? null, p_code: body.code ?? null, p_name: body.name, p_description: body.description ?? null, p_sort: body.sortOrder ?? null, p_active: body.active ?? null }) }));
