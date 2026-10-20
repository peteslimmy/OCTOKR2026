import type { ChartSpec } from "@/lib/reports/types";

// Plain SVG charts with no client JavaScript. Every chart has a text alternative (a data table), distinguishes series by marker shape and
// dash pattern as well as colour, leaves gaps for missing values (never zeros), and labels projected values as projections.

const COLORS = ["#7f1519", "#1d4ed8", "#15803d", "#b45309", "#6d28d9", "#0f766e", "#be185d", "#475569"];
const MARKERS = ["circle", "square", "triangle", "diamond"] as const;
const DASH = ["", "6 3", "2 3", "8 3 2 3"];

const niceMax = (v: number) => (v <= 0 ? 1 : 10 ** Math.floor(Math.log10(v)) * [1, 2, 2.5, 5, 10].find((m) => m * 10 ** Math.floor(Math.log10(v)) >= v)!);
const fmt = (n: number, unit: string) => (unit === "%" ? `${n.toFixed(1)}%` : unit === "NGN" ? n.toLocaleString("en-NG", { maximumFractionDigits: 0 }) : Number.isInteger(n) ? String(n) : n.toFixed(1));

function Marker({ shape, x, y, color }: { shape: (typeof MARKERS)[number]; x: number; y: number; color: string }) {
  const s = 4.5;
  if (shape === "square") return <rect x={x - s} y={y - s} width={2 * s} height={2 * s} fill={color} />;
  if (shape === "triangle") return <polygon points={`${x},${y - s - 1} ${x - s - 1},${y + s} ${x + s + 1},${y + s}`} fill={color} />;
  if (shape === "diamond") return <polygon points={`${x},${y - s - 1} ${x + s + 1},${y} ${x},${y + s + 1} ${x - s - 1},${y}`} fill={color} />;
  return <circle cx={x} cy={y} r={s} fill={color} />;
}

function Legend({ names, projected }: { names: string[]; projected?: boolean }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
      {names.map((n, i) => (
        <li key={n} className="flex items-center gap-1.5">
          <svg width="26" height="10" aria-hidden><line x1="0" y1="5" x2="20" y2="5" stroke={COLORS[i % COLORS.length]} strokeWidth="2" strokeDasharray={DASH[i % DASH.length]} /><Marker shape={MARKERS[i % MARKERS.length]} x={10} y={5} color={COLORS[i % COLORS.length]} /></svg>
          {n}
        </li>
      ))}
      {projected ? <li className="flex items-center gap-1.5"><svg width="26" height="10" aria-hidden><line x1="0" y1="5" x2="22" y2="5" stroke="#565d66" strokeWidth="2" strokeDasharray="4 3" /></svg>Dashed = projection, not a result</li> : null}
    </ul>
  );
}

function DataTable({ spec }: { spec: ChartSpec }) {
  const xs = [...new Set(spec.series.flatMap((s) => s.points.map((p) => p.x)))];
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted underline">View as table</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full text-left">
          <caption className="sr-only">{spec.title}</caption>
          <thead><tr><th scope="col" className="py-1 pr-4 font-medium">&nbsp;</th>{spec.series.map((s) => <th key={s.name} scope="col" className="py-1 pr-4 font-medium">{s.name}</th>)}</tr></thead>
          <tbody>{xs.map((x) => (
            <tr key={x} className="border-t border-line"><th scope="row" className="py-1 pr-4 font-normal">{spec.series.flatMap((s) => s.points).find((p) => p.x === x)?.label ?? x}</th>
              {spec.series.map((s) => { const p = s.points.find((q) => q.x === x); return <td key={s.name} className="py-1 pr-4 tabular-nums">{p && p.y !== null ? `${fmt(p.y, spec.unit)}${p.kind === "projected" ? " (projected)" : ""}` : "—"}</td>; })}</tr>))}</tbody>
        </table>
      </div>
    </details>
  );
}

const W = 760, H = 300, M = { l: 52, r: 16, t: 14, b: 40 };

export function LineChart({ spec }: { spec: ChartSpec }) {
  const xs = [...new Set(spec.series.flatMap((s) => s.points.map((p) => p.x)))];
  const vals = spec.series.flatMap((s) => s.points.flatMap((p) => [p.y, p.low, p.high])).filter((v): v is number => typeof v === "number");
  if (!xs.length || !vals.length) return <p className="text-sm text-muted">Not enough scored data to draw this chart yet.</p>;
  const yMin = spec.yMin ?? Math.min(0, ...vals);
  const yMax = spec.yMax ?? niceMax(Math.max(...vals));
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const x = (i: number) => M.l + (xs.length === 1 ? iw / 2 : (i * iw) / (xs.length - 1));
  const y = (v: number) => M.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin));
  const step = Math.ceil(xs.length / 12);
  const hasProjection = spec.series.some((s) => s.points.some((p) => p.kind === "projected"));
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${spec.title}. ${spec.series.length} series over ${xs.length} periods.`} className="h-auto w-full">
        <title>{spec.title}</title>
        {ticks.map((t) => (
          <g key={t}><line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" /><text x={M.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{fmt(t, spec.unit)}</text></g>
        ))}
        {xs.map((label, i) => (i % step === 0 ? <text key={label} x={x(i)} y={H - 16} textAnchor="middle" fontSize="11" fill="var(--muted)">{label}</text> : null))}
        {spec.series.map((s, si) => {
          const color = COLORS[si % COLORS.length];
          const pts = xs.map((lx, i) => ({ i, p: s.points.find((q) => q.x === lx) })).filter((q) => q.p && q.p.y !== null) as { i: number; p: NonNullable<(typeof s.points)[number]> & { y: number } }[];
          const actual = pts.filter((q) => q.p.kind !== "projected");
          const proj = pts.filter((q) => q.p.kind === "projected" || q.p.kind === undefined ? false : false);
          void proj;
          const projected = pts.filter((q) => q.p.kind === "projected");
          const anchor = actual.length ? actual[actual.length - 1] : null;
          const segs = (list: typeof pts) => list.reduce<string[]>((acc, q, k) => { acc.push(`${k === 0 || list[k - 1].i !== q.i - 1 ? "M" : "L"}${x(q.i)},${y(q.p.y)}`); return acc; }, []).join(" ");
          const band = projected.filter((q) => typeof q.p.low === "number" && typeof q.p.high === "number");
          return (
            <g key={s.name}>
              {band.length ? <polygon fill={color} opacity="0.14" points={[...band.map((q) => `${x(q.i)},${y(q.p.high as number)}`), ...[...band].reverse().map((q) => `${x(q.i)},${y(q.p.low as number)}`)].join(" ")} /> : null}
              <path d={segs(actual)} fill="none" stroke={color} strokeWidth="2.25" strokeDasharray={DASH[si % DASH.length]} />
              {projected.length ? <path d={segs(anchor ? [anchor, ...projected] : projected)} fill="none" stroke={color} strokeWidth="2.25" strokeDasharray="4 4" /> : null}
              {pts.map((q) => <g key={q.i}><Marker shape={MARKERS[si % MARKERS.length]} x={x(q.i)} y={y(q.p.y)} color={color} /><title>{`${s.name}, ${q.p.label ?? xs[q.i]}: ${fmt(q.p.y, spec.unit)}${q.p.kind === "projected" ? " (projected)" : ""}`}</title></g>)}
            </g>
          );
        })}
      </svg>
      <figcaption className="text-xs text-muted">{spec.caption}</figcaption>
      <Legend names={spec.series.map((s) => s.name)} projected={hasProjection} />
      <DataTable spec={spec} />
    </figure>
  );
}

export function BarChart({ spec }: { spec: ChartSpec }) {
  const cats = [...new Set(spec.series.flatMap((s) => s.points.map((p) => p.x)))];
  const vals = spec.series.flatMap((s) => s.points.map((p) => p.y)).filter((v): v is number => typeof v === "number");
  if (!cats.length || !vals.length) return <p className="text-sm text-muted">Nothing to chart for this selection.</p>;
  const max = spec.yMax ?? niceMax(Math.max(...vals, 0));
  const min = Math.min(spec.yMin ?? 0, ...vals, 0);
  const labelW = 150, rowH = 14 * spec.series.length + 14, Hh = cats.length * rowH + 30, iw = W - labelW - 56;
  const scale = (v: number) => ((v - min) / (max - min || 1)) * iw;
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label={`${spec.title}. ${cats.length} categories.`} className="h-auto w-full">
        <title>{spec.title}</title>
        <line x1={labelW + scale(0)} x2={labelW + scale(0)} y1={4} y2={Hh - 22} stroke="var(--muted)" />
        {cats.map((cat, ci) => {
          const y0 = 6 + ci * rowH;
          return (
            <g key={cat}>
              <text x={labelW - 8} y={y0 + rowH / 2} textAnchor="end" fontSize="11.5" fill="var(--ink)">{cat.length > 22 ? `${cat.slice(0, 21)}…` : cat}<title>{cat}</title></text>
              {spec.series.map((s, si) => {
                const p = s.points.find((q) => q.x === cat);
                const v = p?.y;
                const bw = 11, by = y0 + si * (bw + 2) + 2;
                return v === null || v === undefined ? <text key={s.name} x={labelW + 4} y={by + 9} fontSize="10" fill="var(--muted)">—</text> : (
                  <g key={s.name}>
                    <rect x={labelW + Math.min(scale(0), scale(v))} y={by} width={Math.max(1, Math.abs(scale(v) - scale(0)))} height={bw} fill={COLORS[si % COLORS.length]} rx="2"><title>{`${cat}, ${s.name}: ${fmt(v, spec.unit)}`}</title></rect>
                    <text x={labelW + Math.max(scale(v), scale(0)) + 5} y={by + 9} fontSize="10.5" fill="var(--ink)">{fmt(v, spec.unit)}</text>
                  </g>
                );
              })}
            </g>
          );
        })}
        <text x={labelW} y={Hh - 6} fontSize="10.5" fill="var(--muted)">{spec.unit === "%" ? "Percent" : spec.unit}</text>
      </svg>
      {spec.caption ? <figcaption className="text-xs text-muted">{spec.caption}</figcaption> : null}
      {spec.series.length > 1 ? <Legend names={spec.series.map((s) => s.name)} /> : null}
      <DataTable spec={spec} />
    </figure>
  );
}

export function Chart({ spec, level = 3 }: { spec: ChartSpec; level?: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="space-y-2">
      <Heading className="text-sm font-semibold text-ink">{spec.title}</Heading>
      {spec.kind === "bar" ? <BarChart spec={spec} /> : <LineChart spec={spec} />}
    </div>
  );
}
