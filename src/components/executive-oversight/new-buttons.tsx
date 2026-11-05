"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/client";
import type { EoCaps } from "@/lib/executive-oversight/caps";
import type { EoCategory } from "@/lib/executive-oversight/types";
import { CommentForm, RecommendationDialog, type EoSubject, type Unit } from "./forms";

const GENERAL: EoSubject = { module: "BU_PERFORMANCE", subjectType: null, subjectId: null, subjectLabel: null, businessUnitId: null, quarterId: null, reportingWeekId: null };

/** Start a comment or a recommendation from the Executive Oversight page itself (no particular screen behind it). */
export function NewButtons({ caps, units, categories }: { caps: EoCaps; units: Unit[]; categories: EoCategory[] }) {
  const [comment, setComment] = useState(false);
  const [rec, setRec] = useState(false);
  const router = useRouter();
  return (
    <>
      {caps.comment ? <Button variant="secondary" onClick={() => setComment(true)}>Add a comment</Button> : null}
      {caps.recommend ? <Button onClick={() => setRec(true)}>Make a recommendation</Button> : null}
      <Modal open={comment} onOpenChange={setComment} title="Add a comment" description="An observation or a question. It does not start a response workflow.">
        <CommentForm subject={GENERAL} units={units} categories={categories} canOrgWide={caps.viewAll} onDone={() => { setComment(false); router.refresh(); }} />
      </Modal>
      {rec ? <RecommendationDialog open={rec} onOpenChange={setRec} subject={GENERAL} units={units} categories={categories} onDone={(id) => router.push(`/executive-oversight/recommendations/${id}`)} /> : null}
    </>
  );
}
