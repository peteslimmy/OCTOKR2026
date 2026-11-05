"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { apiRequest, useAction } from "@/components/ui/client";
import { Badge, Button, Input } from "@/components/ui/primitives";

export interface BuGoalItem { id: string; title: string; status: "ACTIVE" | "RETIRED"; weeklyGoals: number }

/** The unit's own goals for the quarter: add, rename, retire and restore. Retiring keeps the weekly goals that already point at it. */
export function BuGoalsManager({ goals, businessUnitId, quarterId, locked }: { goals: BuGoalItem[]; businessUnitId: string; quarterId: string; locked: boolean }) {
  const { run, pending } = useAction();
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const save = (body: { id?: string; title: string; status?: "ACTIVE" | "RETIRED" }, success: string) =>
    run(() => apiRequest("POST", "bu-goals", { ...body, businessUnitId, quarterId }), { success });

  return (
    <div className="space-y-4 px-6 py-4">
      {goals.length === 0 ? <p className="text-sm text-muted">No goals yet. Add the goals your unit is committing to this quarter; every weekly goal you write will then be aligned to one of them as well as to a Sub-KR.</p> : (
        <ol className="divide-y divide-line rounded-lg border border-line">
          {goals.map((g, i) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              {editing?.id === g.id ? (
                <form className="flex flex-1 gap-2" onSubmit={async (e) => { e.preventDefault(); if (await save({ id: g.id, title: editing.title, status: g.status }, "Goal saved.")) setEditing(null); }}>
                  <Input aria-label="Goal title" value={editing.title} onChange={(e) => setEditing({ id: g.id, title: e.target.value })} maxLength={500} required autoFocus />
                  <Button type="submit" size="sm" disabled={pending || !editing.title.trim()}>Save</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </form>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className={g.status === "RETIRED" ? "text-muted line-through" : "font-medium"}><span className="mr-2 text-muted">BU Goal {i + 1}</span>{g.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      {g.status === "RETIRED" ? <Badge tone="locked">Retired</Badge> : null}
                      {g.weeklyGoals} weekly {g.weeklyGoals === 1 ? "goal" : "goals"} aligned
                    </p>
                  </div>
                  {locked ? null : (
                    <span className="flex gap-2">
                      {g.status === "ACTIVE" ? <Button size="sm" variant="ghost" aria-label={`Rename ${g.title}`} onClick={() => setEditing({ id: g.id, title: g.title })}><Pencil className="h-4 w-4" aria-hidden />Edit</Button> : null}
                      <Button size="sm" variant="secondary" disabled={pending}
                        onClick={() => save({ id: g.id, title: g.title, status: g.status === "ACTIVE" ? "RETIRED" : "ACTIVE" }, g.status === "ACTIVE" ? "Goal retired." : "Goal restored.")}>{g.status === "ACTIVE" ? "Retire" : "Restore"}</Button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {locked ? <p className="text-sm text-muted">This quarter is locked, so its goals can no longer be changed.</p> : (
        <form className="flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); if (await save({ title }, "Goal added.")) setTitle(""); }}>
          <Input aria-label="New Business Unit goal" placeholder="e.g. Grow partner NGO revenue by 20% by end of quarter" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} className="min-w-72 flex-1" />
          <Button type="submit" disabled={pending || !title.trim()}><Plus className="h-4 w-4" aria-hidden />Add goal</Button>
        </form>
      )}
    </div>
  );
}
