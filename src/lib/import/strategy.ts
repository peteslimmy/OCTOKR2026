/**
 * Reads the strategy sheet (ADR-079): one row per Sub-KR.
 *
 *   Year | Quarter | Objective | KR | KR title | Sub-KR | Sub-KR title
 *
 * "Quarter" is 1 to 4 or Q1 to Q4. "KR" is 1 to 4 (or KR-1). "Sub-KR" is its number within the key result (1, 2, 3, or 1.2 / KR-1.2 where the part after
 * the dot is used). A blank Year, Quarter, Objective, KR or KR title repeats the row above. Pure functions; the database re-checks everything.
 */
export interface StrategyRow { row_no: number; year: number; quarter: number; objective: string; kr_no: number; kr_title: string; sub_no: number; sub_title: string }
export interface StrategyProblem { row: number; message: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const NAMES = {
  year: ["year"], quarter: ["quarter", "qtr", "q"], objective: ["objective", "quarterlyobjective", "obj"],
  kr: ["kr", "krno", "krnumber", "keyresult", "keyresultno"], krTitle: ["krtitle", "keyresulttitle", "keyresulttext"],
  sub: ["subkr", "subkrno", "subkrnumber", "subkrcode", "subkeyresult"], subTitle: ["subkrtitle", "subkrtext", "subkeyresulttitle", "subkrdescription"],
} as const;

export function detectStrategyLayout(headers: string[]): { cols: Record<keyof typeof NAMES, number> } | { error: string } {
  const h = headers.map(norm);
  const find = (names: readonly string[]) => h.findIndex((x) => names.includes(x));
  const cols = Object.fromEntries((Object.keys(NAMES) as (keyof typeof NAMES)[]).map((k) => [k, find(NAMES[k])])) as Record<keyof typeof NAMES, number>;
  const label = { year: "Year", quarter: "Quarter", objective: "Objective", kr: "KR", krTitle: "KR title", sub: "Sub-KR", subTitle: "Sub-KR title" } as const;
  const missing = (Object.keys(cols) as (keyof typeof NAMES)[]).filter((k) => cols[k] < 0).map((k) => label[k]);
  if (missing.length) return { error: `The sheet needs these columns: ${missing.join(", ")}. The first row must hold the column names.` };
  return { cols };
}

const numberIn = (v: string) => { const m = v.match(/\d+/g); return m ? Number(m[m.length - 1]) : NaN; };

export function parseStrategyRows(headers: string[], rows: string[][]): { rows: StrategyRow[]; problems: StrategyProblem[] } | { error: string } {
  const d = detectStrategyLayout(headers);
  if ("error" in d) return d;
  const c = d.cols;
  const out: StrategyRow[] = [], problems: StrategyProblem[] = [];
  let year = "", quarter = "", objective = "", kr = "", krTitle = "";
  rows.forEach((r, i) => {
    const row = i + 2;
    const cell = (n: number) => (r[n] ?? "").trim();
    if (r.every((x) => !x || !x.trim())) return;
    if (cell(c.year)) year = cell(c.year);
    if (cell(c.quarter)) quarter = cell(c.quarter);
    if (cell(c.objective)) objective = cell(c.objective);
    if (cell(c.kr)) { if (cell(c.kr) !== kr) krTitle = ""; kr = cell(c.kr); }
    if (cell(c.krTitle)) krTitle = cell(c.krTitle);
    const y = Number(year.replace(/\.0+$/, "")), q = numberIn(quarter), k = numberIn(kr), s = numberIn(cell(c.sub));
    if (!Number.isInteger(y) || y < 2000 || y > 2100) return void problems.push({ row, message: `Year "${year}" is not a year.` });
    if (!Number.isInteger(q) || q < 1 || q > 4) return void problems.push({ row, message: `Quarter "${quarter}" must be 1 to 4 (or Q1 to Q4).` });
    if (!Number.isInteger(k) || k < 1 || k > 4) return void problems.push({ row, message: `KR "${kr}" must be 1 to 4.` });
    if (!Number.isInteger(s) || s < 1) return void problems.push({ row, message: `Sub-KR "${cell(c.sub)}" must be a number such as 1, 2 or 1.2.` });
    for (const [label, v] of [["Objective", objective], ["KR title", krTitle], ["Sub-KR title", cell(c.subTitle)]] as const) {
      if (!v) return void problems.push({ row, message: `${label} is empty.` });
      if (/^[=+@]/.test(v)) return void problems.push({ row, message: `${label} starts with a formula character (= + @). Formulas are not accepted.` });
    }
    out.push({ row_no: row, year: y, quarter: q, objective, kr_no: k, kr_title: krTitle, sub_no: s, sub_title: cell(c.subTitle) });
  });
  if (!out.length && !problems.length) return { error: "The sheet has no data rows." };
  return { rows: out, problems };
}
