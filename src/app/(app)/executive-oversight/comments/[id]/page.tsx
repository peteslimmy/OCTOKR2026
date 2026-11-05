import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/primitives";
import { CommentThread } from "@/components/executive-oversight/comment-thread";
import { requireActor } from "@/lib/auth/actor";
import { getComment } from "@/lib/data/executive-oversight";
import { eoCaps } from "@/lib/executive-oversight/caps";

export const metadata: Metadata = { title: "Executive comment" };

export default async function CommentPage({ params }: PageProps<"/executive-oversight/comments/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const actor = await requireActor();
  const c = await getComment(id);
  if (!c) notFound();                                       // not found and not permitted look the same
  return (
    <>
      <PageHeader title={c.reference} description="An executive observation and its conversation. A comment asks for no formal response and changes no record." />
      <Card className="p-6"><CommentThread id={c.id} initial={c} caps={eoCaps(actor)} /></Card>
      <p className="mt-3 text-xs text-muted"><Link className="underline" href="/executive-oversight?tab=comments">Back to the comment register</Link></p>
    </>
  );
}
