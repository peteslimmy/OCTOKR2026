import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";
import { searchComments } from "@/lib/data/executive-oversight";

const g = (sp: URLSearchParams, k: string) => sp.get(k) || undefined;

/** GET /api/v1/executive-comments?q=&bu=&quarter=&week=&from=&to=&category=&module=&author=&subjectType=&subjectId=&status=&limit=&offset= — the comment register (what the caller may read). */
export const GET = api({}, async ({ req }) => {
  const sp = new URL(req.url).searchParams;
  return searchComments({ q: g(sp, "q"), bu: g(sp, "bu"), quarter: g(sp, "quarter"), week: g(sp, "week"), from: g(sp, "from"), to: g(sp, "to"), category: g(sp, "category"), module: g(sp, "module"), author: g(sp, "author"),
    subjectType: g(sp, "subjectType"), subjectId: g(sp, "subjectId"), status: g(sp, "status"), limit: Math.min(Number(g(sp, "limit")) || 25, 100), offset: Number(g(sp, "offset")) || 0 });
});

/**
 * POST /api/v1/executive-comments — executive_comment.create. The author, the role and the time are taken from the signed-in session, never from the body; the unit, quarter and week are
 * inherited from the record being reviewed. A comment is not a recommendation and changes no operational record. A repeated request key returns the first result.
 */
export const POST = api({ body: S.createComment }, async ({ actor, body, rpc }) =>
  rpc("create_eo_comment", { p_actor: actor.id, p_bu: body.businessUnitId ?? null, p_category: body.category ?? null, p_title: body.title ?? null, p_content: body.content, p_visibility: body.visibility, p_module: body.module,
    p_subject_type: body.subjectType ?? null, p_subject_id: body.subjectId ?? null, p_quarter: body.quarterId ?? null, p_week: body.reportingWeekId ?? null, p_links: body.links, p_key: body.requestKey ?? null }));
