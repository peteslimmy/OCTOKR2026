import { api } from "@/lib/api/handler";
import * as S from "@/lib/executive-oversight/schemas";
import { searchRecommendations } from "@/lib/data/executive-oversight";
import { saveArgs } from "@/lib/executive-oversight/save-args";

const g = (sp: URLSearchParams, k: string) => sp.get(k) || undefined;

/** GET /api/v1/executive-recommendations?q=&bu=&quarter=&week=&from=&to=&priority=&status=&author=&category=&module=&overdue=true&awaiting=BU|EXECUTIVE&dueFrom=&dueTo=&subjectType=&subjectId=&sort=priority|recent|due — one line per addressed unit. */
export const GET = api({}, async ({ req }) => {
  const sp = new URL(req.url).searchParams;
  return searchRecommendations({ q: g(sp, "q"), bu: g(sp, "bu"), quarter: g(sp, "quarter"), week: g(sp, "week"), from: g(sp, "from"), to: g(sp, "to"), priority: g(sp, "priority"), status: g(sp, "status"), author: g(sp, "author"),
    category: g(sp, "category"), module: g(sp, "module"), overdue: g(sp, "overdue") === "true", awaiting: g(sp, "awaiting"), dueFrom: g(sp, "dueFrom"), dueTo: g(sp, "dueTo"), subjectType: g(sp, "subjectType"), subjectId: g(sp, "subjectId"),
    sort: g(sp, "sort"), limit: Math.min(Number(g(sp, "limit")) || 25, 100), offset: Number(g(sp, "offset")) || 0 });
});

/**
 * POST /api/v1/executive-recommendations — executive_recommendation.create. Saves a draft, or issues it at once with publish:true.
 * A recommendation is advice: it modifies no record and approves nothing; each addressed unit answers separately. 409 DUPLICATE_RECOMMENDATION for the same recommendation to the same units within minutes.
 */
export const POST = api({ body: S.saveRecommendation }, async ({ actor, body, rpc }) => rpc("save_eo_recommendation", saveArgs(actor.id, null, body)));
