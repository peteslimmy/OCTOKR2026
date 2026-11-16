"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiUpload, ApiFailure, Modal, toast } from "@/components/ui/client";
import { describeFailure, FailurePanel, type Failure } from "@/components/import-feedback";
import { Button } from "@/components/ui/primitives";
import { buGoalTemplateCsv } from "@/lib/reports/bu-goal-upload";

/** A BU Lead adds many quarterly goals at once from a .csv or .xlsx. Everything is checked first; if any row has a problem nothing is added and every problem is listed. */
export function BulkBuGoalsButton({ businessUnitId, quarterId }: { businessUnitId: string; quarterId: string }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const template = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buGoalTemplateCsv()], { type: "text/csv;charset=utf-8" }));
    a.download = "business-unit-goals-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const upload = async () => {
    if (!file) return;
    setProblems([]); setFailure(null); setPending(true);
    try {
      const out = await apiUpload<{ created: number }>(`bu-goals/upload?businessUnitId=${businessUnitId}&quarterId=${quarterId}`, file);
      toast.success(`${out.created} ${out.created === 1 ? "goal" : "goals"} added.`);
      setOpen(false); setFile(null);
      router.refresh();
    } catch (e) {
      const f = e as ApiFailure;
      if (Array.isArray(f.details)) setProblems([f.message, ...(f.details as string[])]);
      else setFailure(describeFailure(e, "The upload"));
    } finally { setPending(false); }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setProblems([]); setOpen(true); }}><Upload className="h-4 w-4" aria-hidden />Upload goals</Button>
      <Modal open={open} onOpenChange={setOpen} title="Upload your unit's goals" description="Add many goals for this quarter at once from a .csv or .xlsx file. If any row has a problem, nothing is added and the problems are listed.">
        <div className="space-y-3 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>One goal on each row, under the heading <strong className="font-medium text-ink">Goal</strong> (up to 500 characters, at most 100 goals).</li>
            <li>A goal your unit already has this quarter, or the same goal twice in the file, is refused.</li>
            <li>The goals are added as active goals. Once Admin locks the quarter, changes need an approved request.</li>
          </ul>
          <button type="button" onClick={template} className="text-brand-700 underline">Download the template (.csv)</button>
          <div>
            <label htmlFor="bu-goals-file" className="mb-1 block font-medium">File</label>
            <input id="bu-goals-file" type="file" accept=".csv,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setProblems([]); setFailure(null); }}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5" />
          </div>
          {failure ? <FailurePanel f={failure} /> : null}
          {problems.length ? (
            <div role="alert" className="max-h-64 overflow-y-auto rounded-lg bg-[var(--notdone-bg)] p-3 text-[var(--notdone-fg)]">
              <p className="font-medium">{problems[0]}</p>
              {problems.length > 1 ? <ul className="mt-1 list-disc pl-5">{problems.slice(1).map((p, i) => <li key={i}>{p}</li>)}</ul> : null}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={pending || !file} onClick={() => void upload()}>{pending ? "Uploading…" : "Upload and add goals"}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
