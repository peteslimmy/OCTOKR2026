import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { RecommendationView } from "@/components/executive-oversight/recommendation-view";
import { requireActor } from "@/lib/auth/actor";
import { listBusinessUnits } from "@/lib/data";
import { getRecommendation, listCategories, listPeople } from "@/lib/data/executive-oversight";
import { eoCaps } from "@/lib/executive-oversight/caps";
import type { EoPerson } from "@/lib/executive-oversight/types";

export const metadata: Metadata = { title: "Recommendation" };

export default async function RecommendationPage({ params }: PageProps<"/executive-oversight/recommendations/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const actor = await requireActor();
  const caps = eoCaps(actor);
  const rec = await getRecommendation(id);
  if (!rec) notFound();                                     // not found and not permitted look the same
  const editing = rec.status === "DRAFT" && rec.author_id === actor.id;
  const [units, categories, mine] = await Promise.all([
    editing ? listBusinessUnits().then((u) => u.filter((x) => x.status === "ACTIVE").map((x) => ({ id: x.id, name: x.name }))) : Promise.resolve([]),
    editing ? listCategories().catch(() => []) : Promise.resolve([]),
    caps.respond && caps.viewerBu ? listPeople(actor.id, caps.viewerBu).catch(() => [] as EoPerson[]) : Promise.resolve([] as EoPerson[]),
  ]);
  return (
    <>
      <PageHeader title={rec.reference ?? "Draft recommendation"} description="A recommendation is advice. Each addressed unit answers separately, and nothing here changes its records." />
      <RecommendationView rec={rec} caps={caps} units={units} categories={categories} unitPeople={caps.viewerBu ? { [caps.viewerBu]: mine } : {}} />
    </>
  );
}
