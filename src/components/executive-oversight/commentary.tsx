import { requireActor } from "@/lib/auth/actor";
import { listBusinessUnits } from "@/lib/data";
import { getContext, listCategories } from "@/lib/data/executive-oversight";
import { eoCaps } from "@/lib/executive-oversight/caps";
import { CommentaryPanel } from "./commentary-panel";

export interface CommentaryProps {
  module: string; subjectType?: string | null; subjectId?: string | null; subjectLabel?: string | null; businessUnitId?: string | null; quarterId?: string | null; reportingWeekId?: string | null; label?: string;
}

/**
 * The contextual "Executive Commentary" action, dropped onto any BU-related screen. Nothing is drawn for a role that cannot read executive commentary. The record's unit, quarter and week are
 * passed in by the screen, so the person never re-enters them. Reading it changes nothing.
 */
export async function ExecutiveCommentary(p: CommentaryProps) {
  const actor = await requireActor();
  const caps = eoCaps(actor);
  if (!caps.viewComments && !caps.viewRecs) return null;
  const subject = { module: p.module, subjectType: p.subjectType ?? null, subjectId: p.subjectId ?? null, subjectLabel: p.subjectLabel ?? null, businessUnitId: p.businessUnitId ?? null, quarterId: p.quarterId ?? null, reportingWeekId: p.reportingWeekId ?? null };
  const [units, categories, initial] = await Promise.all([
    caps.comment || caps.recommend ? listBusinessUnits().then((u) => u.filter((x) => x.status === "ACTIVE").map((x) => ({ id: x.id, name: x.name }))) : Promise.resolve([]),
    caps.comment || caps.recommend ? listCategories().catch(() => []) : Promise.resolve([]),
    getContext({ subjectType: subject.subjectType, subjectId: subject.subjectId, bu: subject.businessUnitId, module: subject.module }).catch(() => null),
  ]);
  return <CommentaryPanel subject={subject} units={units} categories={categories} caps={caps} initial={initial} label={p.label} />;
}
