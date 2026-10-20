// Deterministic, rule-based SMART evaluator (ADR-039). Pure function: same input => same output.
// SMART quality is guidance only and never blocks submission (BR-GOAL-003).

export const SMART_ENGINE_VERSION = "smart-rules-1.0.0";

export interface SmartEvaluation {
  specific: number;
  measurable: number;
  achievable: number;
  relevant: number;
  timeBound: number;
  overall: number;
  warnings: string[];
  suggestions: string[];
  engineVersion: string;
}

export interface SmartInput {
  title: string;
  description?: string | null;
  taskDescriptions: string[];
  /** Title of the mapped Sub-KR; null for Stretch goals. */
  subKrTitle?: string | null;
  goalType: "KR_ALIGNED" | "STRETCH";
}

const ACTION_VERBS = [
  "launch", "complete", "deliver", "publish", "onboard", "reduce", "increase", "implement", "close", "sign",
  "train", "migrate", "fix", "resolve", "reach", "achieve", "submit", "review", "approve", "deploy", "schedule",
  "hire", "audit", "reconcile", "draft", "finalise", "finalize", "collect", "convert", "renew", "ship", "record",
  "upgrade", "design", "build", "test", "document", "present", "negotiate", "grow", "improve", "raise", "secure",
  "establish", "create", "prepare", "hold", "run", "visit", "call", "interview", "process", "clear", "recover",
  "remove", "install", "configure", "calculate", "analyse", "analyze", "map", "redesign", "update", "plan", "generate", "source",
  "develop", "write", "produce", "identify", "send", "obtain", "finish", "evaluate", "research", "automate", "streamline", "validate",
  "monitor", "track", "organise", "organize", "coordinate", "execute", "demonstrate", "pilot", "refactor", "release", "resolve",
];
const VAGUE = ["try", "maybe", "improve things", "work on", "look into", "help with", "stuff", "various", "etc", "as needed", "asap"];
const TIME_WORDS =
  /\b(by|before|until|within|end of|every|each|weekly|daily|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|eod|eow|q[1-4]|january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|this week|next week|this month|\d{1,2}[/-]\d{1,2}|\d{1,2}(st|nd|rd|th)|\d{1,2}\s?(am|pm)|\d{1,2}:\d{2})\b/i;
const NUMBER = /\d+([.,]\d+)?/;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

export function evaluateSmart(input: SmartInput): SmartEvaluation {
  const title = input.title.trim();
  const body = `${title} ${input.description ?? ""} ${input.taskDescriptions.join(" ")}`.toLowerCase();
  const titleWords = words(title);
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Specific: concrete action verb, enough words, no vagueness markers
  let specific = 30;
  const first = titleWords[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  if (ACTION_VERBS.includes(first)) specific += 30;
  else if (ACTION_VERBS.some((v) => new RegExp(`\\b${v}\\b`, "i").test(title))) specific += 15;
  if (titleWords.length >= 5) specific += 20;
  if (titleWords.length >= 8) specific += 10;
  if (input.taskDescriptions.length >= 2) specific += 10;
  const vagueHits = VAGUE.filter((v) => new RegExp(`\\b${v}\\b`, "i").test(body));
  specific -= vagueHits.length * 15;
  if (specific < 70) {
    warnings.push("The goal wording is not very specific.");
    suggestions.push(
      "Start with a concrete action verb and name the deliverable, e.g. “Publish the Q4 pricing sheet to all sales leads”.",
    );
  }
  if (vagueHits.length) suggestions.push(`Replace vague wording (${vagueHits.join(", ")}) with the exact outcome.`);

  // Measurable: numbers/units in goal or tasks
  let measurable = 20;
  if (NUMBER.test(title)) measurable += 50;
  else if (NUMBER.test(body)) measurable += 30;
  if (/\b(\d+\s?%|percent|target|kpi|metric)\b/i.test(body)) measurable += 20;
  if (input.taskDescriptions.some((t) => NUMBER.test(t))) measurable += 10;
  if (measurable < 70) {
    warnings.push("No clear measure of success was found.");
    suggestions.push(
      "Add a number, percentage or count so completion can be verified (e.g. “close 5 invoices” or “reduce churn to 3%”).",
    );
  }

  // Achievable: bounded scope with a plan
  let achievable = 50;
  if (input.taskDescriptions.length >= 1) achievable += 20;
  if (input.taskDescriptions.length >= 3) achievable += 10;
  if (input.taskDescriptions.length > 12) achievable -= 15;
  if (/\b(all|every|always|never|100%|completely|entire)\b/i.test(title)) achievable -= 15;
  if (titleWords.length > 40) achievable -= 15;
  if (achievable < 70) {
    warnings.push("Scope or plan may be unrealistic for one week.");
    suggestions.push("Break the goal into 2–5 concrete tasks and confirm the scope fits within one reporting week.");
  }

  // Relevant: tied to a Sub-KR, or an explicit stretch goal
  let relevant = input.goalType === "KR_ALIGNED" && input.subKrTitle ? 70 : input.goalType === "STRETCH" ? 55 : 30;
  if (input.subKrTitle) {
    const sk = new Set(words(input.subKrTitle.toLowerCase()).filter((w) => w.length > 4));
    const overlap = words(body).filter((w) => sk.has(w.replace(/[^a-z]/g, ""))).length;
    relevant += Math.min(30, overlap * 10);
  } else if (input.goalType === "STRETCH") {
    relevant += 10;
  }
  if (relevant < 70) {
    warnings.push(
      input.goalType === "STRETCH"
        ? "Stretch goals are not linked to a Sub-KR."
        : "The goal's link to its Sub-KR is not obvious from the wording.",
    );
    suggestions.push(
      input.goalType === "STRETCH"
        ? "Confirm no available Sub-KR applies; otherwise map the goal to one."
        : "Reuse key terms from the Sub-KR so the strategic link is explicit.",
    );
  }

  // Time-bound: explicit deadline or cadence
  let timeBound = 25;
  if (TIME_WORDS.test(title)) timeBound += 60;
  else if (TIME_WORDS.test(body)) timeBound += 40;
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(body)) timeBound += 15;
  if (timeBound < 70) {
    warnings.push("No deadline or timeframe was found.");
    suggestions.push("State when it will be done, e.g. “by Friday 17:00” or “before the next OKR session”.");
  }

  const dims = {
    specific: clamp(specific),
    measurable: clamp(measurable),
    achievable: clamp(achievable),
    relevant: clamp(relevant),
    timeBound: clamp(timeBound),
  };
  const overall = Math.round(((dims.specific + dims.measurable + dims.achievable + dims.relevant + dims.timeBound) / 5) * 100) / 100;
  return { ...dims, overall, warnings, suggestions, engineVersion: SMART_ENGINE_VERSION };
}
