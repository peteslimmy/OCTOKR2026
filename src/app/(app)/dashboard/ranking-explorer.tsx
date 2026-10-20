"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { ScoreText } from "@/components/status";
import { apiRequest, ApiFailure } from "@/components/ui/client";
import { Drawer } from "@/components/ui/drawer";
import { Badge, Button, EmptyState, DataTable } from "@/components/ui/primitives";
import { formatPercent } from "@/lib/format";

export interface RankRow {
  business_unit_id: string; name: string; latest_week_score: number | null; quarter_score: number | null;
  quarter_status: string | null; missing_report_zero_count: number | null;
}
interface RegisterRow { week: string; result: string; compliance: string; review: string; score: number | null; report: string | null }
interface RegisterReport { rows: RegisterRow[]; notes: string[] }
type Show = "ALL" | "MISSING" | "PROVISIONAL";

/**
 * The executive ranking with filters and a drill-down. Filtering only narrows what is displayed (rank numbers stay the real ones);
 * a Business Unit opens a drawer with its week-by-week register, read as the signed-in user through the reports API.
 */
export function RankingExplorer({ rows, quarterId }: { rows: RankRow[]; quarterId: string }) {
  const [show, setShow] = useState<Show>("ALL");
  const [below, setBelow] = useState(100);
  const [open, setOpen] = useState<RankRow | null>(null);
  const [data, setData] = useState<RegisterReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const opener = useRef<HTMLElement | null>(null);

  const load = useCallback(async (bu: RankRow) => {
    const mine = ++seq.current;
    setLoading(true); setErr(null); setData(null);
    try {
      const out = await apiRequest<RegisterReport>("GET", `reports/reporting-register?quarterId=${quarterId}&buId=${bu.business_unit_id}`);
      if (mine === seq.current) setData(out);
    } catch (e) { if (mine === seq.current) setErr((e as ApiFailure).message); }
    if (mine === seq.current) setLoading(false);
  }, [quarterId]);

  const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  const shown = ranked.filter((r) =>
    (show === "ALL" || (show === "MISSING" ? Number(r.missing_report_zero_count ?? 0) > 0 : r.quarter_status === "PROVISIONAL"))
    && (below >= 100 || (r.quarter_score !== null && Number(r.quarter_score) < below)));
  const filtered = show !== "ALL" || below < 100;

  return (
    <>
      <div className="flex flex-wrap items-end gap-4 border-b border-line px-6 py-3 text-sm">
        <div>
          <label htmlFor="rank-show" className="mb-1 block font-medium">Show</label>
          <select id="rank-show" value={show} onChange={(e) => setShow(e.target.value as Show)} className="rounded-lg border border-line bg-panel px-3 py-2">
            <option value="ALL">All Business Units</option><option value="MISSING">With missing reports</option><option value="PROVISIONAL">Provisional scores only</option>
          </select>
        </div>
        <div className="min-w-48 flex-1">
          <label htmlFor="rank-below" className="mb-1 block font-medium">Quarter score below <output htmlFor="rank-below" className="tabular-nums">{below >= 100 ? "any" : formatPercent(below)}</output></label>
          <input id="rank-below" type="range" min={0} max={100} step={5} value={below} onChange={(e) => setBelow(Number(e.target.value))} className="w-full accent-[var(--brand-700)]" />
        </div>
        {filtered ? <Button size="sm" variant="secondary" onClick={() => { setShow("ALL"); setBelow(100); }}>Reset filters</Button> : null}
      </div>
      <p className="sr-only" role="status">{shown.length} of {rows.length} Business Units shown</p>
      {shown.length === 0 ? <EmptyState title="No Business Unit matches these filters" /> : (
        <DataTable caption="Business units ranked by quarterly execution score" columns={[{ label: "#" }, { label: "Business Unit" }, { label: "Latest week", align: "right" }, { label: "Quarter", align: "right" }, { label: "Missing", align: "right" }]}>
              {shown.map((r) => (
                <tr key={r.business_unit_id} className="border-b border-line last:border-0">
                  <td className="tabular-nums text-muted">{r.rank}</td>
                  <td className="font-medium">
                    <button type="button" className="text-left text-brand-700 underline" onClick={(e) => { opener.current = e.currentTarget; setOpen(r); void load(r); }}>{r.name}<span className="sr-only"> — open week-by-week detail</span></button>
                  </td>
                  <td className="text-right"><ScoreText value={r.latest_week_score} /></td>
                  <td className="text-right"><ScoreText value={r.quarter_score} className="font-semibold tabular-nums" />
                    {r.quarter_status === "PROVISIONAL" ? <span className="ml-1 text-xs text-muted">(prov.)</span> : null}</td>
                  <td className="text-right tabular-nums">{r.missing_report_zero_count ?? "–"}</td>
                </tr>
              ))}
            </DataTable>
      )}

      <Drawer returnFocusTo={opener} open={open !== null} onOpenChange={(o) => { if (!o) setOpen(null); }} title={open ? `${open.name}: week by week` : "Business Unit"}
        description="Every week of the quarter so far, as filed. Weeks that have not started are not listed.">
        <div className="space-y-3 text-sm" aria-live="polite">
          {loading ? <p role="status" className="text-muted">Loading…</p> : null}
          {err ? <div role="alert" className="space-y-2"><p className="text-[var(--critical-fg)]">This could not be loaded: {err}</p><Button size="sm" onClick={() => open && void load(open)}>Try again</Button></div> : null}
          {data && data.rows.length === 0 ? <EmptyState title="No weeks have started in this quarter yet" /> : null}
          {data && data.rows.length > 0 ? (
            <DataTable caption={`Weekly register for ${open?.name ?? ""}`} columns={[{ label: "Week" }, { label: "Result" }, { label: "Compliance" }, { label: "Score", align: "right" }]}>
              {data.rows.map((w, i) => (
                <tr key={i}>
                  <th scope="row">{w.week}</th>
                  <td>{w.result}</td>
                  <td><Badge tone={w.compliance === "Compliant" ? "done" : w.compliance === "Non-compliant" ? "critical" : "undefined"}>{w.compliance}</Badge></td>
                  <td className="text-right tabular-nums">{w.report ? <Link href={w.report} className="text-brand-700 underline">{w.score === null ? "Open" : formatPercent(w.score)}</Link> : w.score === null ? "—" : formatPercent(w.score)}</td>
                </tr>
              ))}
            </DataTable>
          ) : null}
          <p className="pt-2 text-xs text-muted">View only. For exports and definitions use <Link href="/reports/reporting-register" className="text-brand-700 underline">the Reporting register</Link>.</p>
        </div>
      </Drawer>
    </>
  );
}
