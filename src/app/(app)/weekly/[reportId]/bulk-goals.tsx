"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { apiUpload, ApiFailure, Modal, toast } from "@/components/ui/client";
import { describeFailure, FailurePanel, type Failure } from "@/components/import-feedback";
import { Button } from "@/components/ui/primitives";
import { goalCodesCsv, goalTemplateCsv } from "@/lib/reports/goal-upload";

/** Add many goals, with their tasks, to this report from a .csv or .xlsx. Everything is checked first; if anything is wrong nothing is added. */
export function BulkGoalsButton({ reportId, buGoals = [] }: { reportId: string; buGoals?: { code: string; title: string }[] }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const template = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([goalTemplateCsv()], { type: "text/csv;charset=utf-8" }));
    a.download = "weekly-goals-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const codes = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([goalCodesCsv(buGoals)], { type: "text/csv;charset=utf-8" }));
    a.download = "business-unit-goal-codes.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const upload = async () => {
    if (!file) return;
    setProblems([]); setFailure(null);
    setPending(true);
    try {
      const out = await apiUpload<{ created: number }>(`weekly-reports/${reportId}/bulk-goals`, file);
      toast.success(`${out.created} ${out.created === 1 ? "goal" : "goals"} added.`);
      setOpen(false); setFile(null);
      router.refresh();
    } catch (e) {
      const f = e as ApiFailure;
      if (Array.isArray(f.details)) setProblems([f.message, ...(f.details as string[])]);   // every problem the server found, row by row, each with what to do
      else setFailure(describeFailure(e, "The upload"));
    } finally { setPending(false); }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setProblems([]); setOpen(true); }}><Upload className="h-4 w-4" aria-hidden />Upload goals</Button>
      <Modal open={open} onOpenChange={setOpen} title="Upload goals for this week"
        description="Add many SMART goals with their tasks at once from a .csv or .xlsx file. If any row has a problem, nothing is added and the problems are listed.">
        <div className="space-y-3 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>One row per task. Columns: <strong className="font-medium text-ink">Goal</strong>, <strong className="font-medium text-ink">Sub-KR</strong> (for example KR1.1; blank for a stretch goal), <strong className="font-medium text-ink">BU goal ID</strong> (the code of one of your unit&apos;s goals, for example BG-1; needed once your unit has set its goals) and <strong className="font-medium text-ink">Task</strong>.</li>
            <li>A row with a Goal starts a new goal. Leave Goal blank to add another task to the goal above.</li>
            <li>Goals are added to this report as drafts. You can edit them until the content lock.</li>
          </ul>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <button type="button" onClick={template} className="text-brand-700 underline">Download the template (.csv)</button>
            {buGoals.length ? <button type="button" onClick={codes} className="text-brand-700 underline">Download your unit&apos;s goal codes (.csv)</button> : null}
          </div>
          <div>
            <label htmlFor="bulk-file" className="mb-1 block font-medium">File</label>
            <input id="bulk-file" ref={input} type="file" accept=".csv,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setProblems([]); setFailure(null); }}
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
