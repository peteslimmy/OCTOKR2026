/**
 * The model may explain; it may not invent a figure (4COREPAL). Every number in an answer has to be one the tools returned. This is the check.
 *
 * It reads each number out of the answer (ignoring ones that are labels, not figures: reference numbers like S1, week and quarter numbers, years, dates,
 * ordinals) and requires it to appear among the numbers of the tool results, allowing the usual rounding (a result of 66.67 may be written 66.7 or 67).
 * An answer with a number that is not in the data is not shown as an answer: the person gets the verified figures and a plain note.
 */
const LABELLED = /\b(?:week|weeks|wk|w|q|quarter|source|sources|s|step|point|item|no\.?)\s*#?\d+(?:\s*(?:-|–|to)\s*\d+)?/gi;
const DATE = /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?\b|\b\d{4}-\d{2}-\d{2}\b/gi;
const YEAR = /\b(?:19|20)\d{2}\b/g;
const ORDINAL = /\b\d+(?:st|nd|rd|th)\b/gi;
const PLACEHOLDER = /\[\[BU:[A-Za-z0-9_-]{1,20}\]\]/g;
const REFERENCE = /\b[A-Z]{2,5}-\d{2,4}-\d{3,6}\b|\bPIC-\S+/g;

/** The figures an answer states, as numbers. */
export function figuresIn(text: string): number[] {
  const t = text.replace(PLACEHOLDER, " ").replace(REFERENCE, " ").replace(DATE, " ").replace(LABELLED, " ").replace(ORDINAL, " ").replace(YEAR, " ");
  const out: number[] = [];
  for (const m of t.matchAll(/(?<![\w.])-?\d+(?:,\d{3})*(?:\.\d+)?%?/g)) {
    const n = Number(m[0].replace(/[,%]/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Every number found anywhere in the tool results (as returned), including those inside strings. */
export function numbersIn(value: unknown, into = new Set<number>()): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) into.add(value);
  else if (typeof value === "string") for (const m of value.matchAll(/-?\d+(?:\.\d+)?/g)) into.add(Number(m[0]));
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, into));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((v) => numbersIn(v, into));
  return into;
}

const matches = (n: number, known: Set<number>) => {
  if (known.has(n)) return true;
  for (const k of known) {
    // written to fewer decimals than the data: 66.667 as 66.7 or 67, 0.667 as 66.7%
    if (Math.abs(k - n) <= 0.05 + 1e-9 || Math.abs(Math.round(k) - n) < 1e-9 || Math.abs(Math.round(k * 10) / 10 - n) < 1e-9 || Math.abs(k * 100 - n) <= 0.05 + 1e-9) return true;
  }
  return false;
};

/** The figures in the answer that no tool returned. Empty means the answer is grounded. */
export function ungrounded(answer: string, toolResults: unknown[]): number[] {
  const known = new Set<number>();
  for (const r of toolResults) numbersIn(r, known);
  // a fall of 10 points is written "fell by 10": the direction is carried by the words, so the size of a recorded change is allowed with either sign
  for (const k of [...known]) if (k < 0) known.add(-k);
  // small whole numbers in prose ("two units", "3 of 5") are counts of things in the result: they must still match, except 0 and 1 which are ordinary words
  return [...new Set(figuresIn(answer))].filter((n) => !(n === 0 || n === 1) && !matches(n, known));
}
