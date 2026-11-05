// Deterministic, rule-based SMART evaluator (ADR-039, engine 2). Pure function: same input => same output.
// SMART quality is guidance only and never blocks submission (BR-GOAL-003).
//
// Engine 2 reads the GOAL the way a reviewer would, with the goal's own words. Tasks are not part of it: they are how the goal gets done and are judged by
// whether they are done, never by this checker.
//   Specific    an action verb, a named deliverable and audience, a sensible length, no vague wording
//   Measurable  a count, amount or percentage; a target ("at least", "from X to Y"); an outcome someone can check (signed, published, approved)
//   Achievable  a scope that fits one week: no all-or-nothing wording, no year-long horizon, a size that is stated, a goal that is not a single word
//   Relevant    how many of the Sub-KR's own key words the goal actually uses (word stems, not exact spellings); a stretch goal stands on its own
//   Time-bound  a deadline that is a moment (a weekday, a date, a time) rather than a general "soon"
// Before any of that, the wording is checked for being real words: a title that does not read as language ("ug iui go oioq") has every score scaled down hard.
// Every score is explained: a dimension below 70 comes with a warning and a suggestion built from the goal's own text.

export const SMART_ENGINE_VERSION = "smart-rules-2.2.0";

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
  /** Title of the mapped Sub-KR; null for Stretch goals. */
  subKrTitle?: string | null;
  goalType: "KR_ALIGNED" | "STRETCH";
}

// ---------------------------------------------------------------- vocabulary
const ACTION_VERBS = [
  "launch", "complete", "deliver", "publish", "onboard", "reduce", "increase", "implement", "close", "sign", "train", "migrate", "fix", "resolve", "reach",
  "achieve", "submit", "review", "approve", "deploy", "schedule", "hire", "audit", "reconcile", "draft", "finalise", "finalize", "collect", "convert", "renew",
  "ship", "record", "upgrade", "design", "build", "test", "document", "present", "negotiate", "grow", "improve", "raise", "secure", "establish", "create",
  "prepare", "hold", "run", "visit", "call", "interview", "process", "clear", "recover", "remove", "install", "configure", "calculate", "analyse", "analyze",
  "map", "redesign", "update", "plan", "generate", "source", "develop", "write", "produce", "identify", "send", "obtain", "finish", "evaluate", "research",
  "automate", "streamline", "validate", "monitor", "track", "organise", "organize", "coordinate", "execute", "demonstrate", "pilot", "refactor", "release",
  "conduct", "initiate", "restructure", "consolidate", "reconcile", "incorporate", "formalise", "formalize", "disburse", "distribute", "circulate", "confirm",
  "compile", "assemble", "arrange", "attend", "facilitate", "lead", "manage", "assign", "allocate", "issue", "file", "register", "enrol", "enroll", "onboard",
  "migrate", "integrate", "connect", "link", "map", "cleanse", "deduplicate", "benchmark", "forecast", "budget", "invoice", "bill", "settle", "pay", "refund",
  "recruit", "orient", "coach", "mentor", "certify", "accredit", "inspect", "verify", "check", "reconfirm", "escalate", "respond", "answer", "report",
  "brief", "pitch", "propose", "quote", "tender", "bid", "win", "renegotiate", "extend", "expand", "scale", "roll", "rollout", "set", "define", "agree",
  "align", "draw", "outline", "summarise", "summarize", "survey", "poll", "ask", "gather", "extract", "load", "import", "export", "backup", "restore",
  "patch", "debug", "troubleshoot", "provision", "decommission", "retire", "archive", "dispose", "procure", "purchase", "order", "receive", "dispatch",
  "deploy", "commission", "handover", "transfer", "hand", "sensitise", "sensitize", "engage", "convene", "chair", "minute", "follow", "cascade", "embed",
  "adopt", "enforce", "comply", "remediate", "mitigate", "rectify", "correct", "amend", "revise", "edit", "proofread", "translate", "publicise", "promote",
];
const VAGUE_PHRASES = [
  "try", "maybe", "perhaps", "improve things", "work on", "look into", "help with", "assist with", "stuff", "things", "various", "etc", "as needed", "asap",
  "as soon as possible", "better", "good", "nice", "some", "a few", "a lot", "ongoing", "continue to", "keep up", "follow up", "support", "handle", "deal with",
  "and so on", "whatever", "somehow", "soon", "later", "regularly", "when possible", "if possible", "hopefully",
];
const SCOPE_INFLATORS = ["all", "every", "everything", "everyone", "entire", "always", "never", "100%", "completely", "fully", "perfect", "perfectly", "zero defects", "end to end"];
const LONG_HORIZON = ["year", "annual", "annually", "multi-year", "quarterly", "long-term", "long term", "all year", "fy"];
const VERIFIABLE = ["signed", "approved", "published", "delivered", "submitted", "completed", "closed", "resolved", "paid", "received", "filed", "issued", "launched", "deployed", "reconciled", "confirmed", "on-boarded", "onboarded"];
const OUTCOME_VERB_STEMS = new Set(["publish", "close", "sign", "approve", "submit", "deliver", "complete", "launch", "deploy", "reconcile", "issue", "file", "send", "finalise", "finalize", "onboard", "resolve", "pay", "disburse", "hire", "register", "certify", "release", "ship", "renew", "convert"].map((v) => v)); // matched on the stem below
const TARGET_WORDS = /\b(at least|no more than|up to|a minimum of|minimum of|maximum of|from \S+ to \S+|by \d+\s?%|target of|at most|not less than|not more than|zero|none|no outstanding|per week|per day)\b/i;
const STOP = new Set(["a", "an", "the", "of", "to", "for", "and", "or", "in", "on", "at", "by", "with", "from", "into", "as", "is", "are", "be", "this", "that", "it", "its", "our", "their", "your", "we", "us", "will", "shall", "per", "via", "all", "each", "every", "any", "new", "go", "deep", "wide"]);
const NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|fifty|hundred|thousand|million|dozen|half|both|first|second|third)\b/i;
const NUMBER = /(?:^|[^a-z0-9])(?:[₦$€£]\s?)?\d+(?:[.,]\d+)*\s?(?:%|k\b|m\b|bn\b)?/i;
const UNITS = /(%|percent|₦|naira|\$|usd|ngn|hours?|hrs?|days?|weeks?|months?|calls?|sheets?|reports?|leads?|clients?|customers?|partners?|sessions?|meetings?|invoices?|tickets?|users?|staff|people|officers?|states?|units?|documents?|modules?|dashboards?|contracts?|proposals?|visits?|trainings?|workshops?|requests?|cases?|records?|accounts?|payments?|disbursements?|kpis?|milestones?)\b/i;

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const WEEKDAY = /\b(mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b/i;
const EXACT_MOMENT = new RegExp(`${WEEKDAY.source}|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\b|\\b(?:${MONTHS})\\s+\\d{1,2}\\b|\\b\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}(?::\\d{2})?\\s?(?:am|pm)\\b|\\b\\d{1,2}:\\d{2}\\b|\\b(?:eod|eow|cob|end of (?:day|week|month|quarter))\\b|\\b(?:today|tomorrow|tonight)\\b`, "i");
const GENERAL_TIME = /\b(by|before|until|within|end of|every|each|weekly|daily|this week|next week|this month|next month|q[1-4]|\d+\s?(?:days?|weeks?|hours?))\b/i;

// ---------------------------------------------------------------- helpers
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** A matching key for a word, so that publish / publishes / published / publishing agree. Not a dictionary stem: only meant to be consistent. */
function stem(raw: string): string {
  let w = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith("ied")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  if (w.length > 3 && w[w.length - 1] === w[w.length - 2]) w = w.slice(0, -1);
  return w;
}
const VERB_STEMS = new Set(ACTION_VERBS.map(stem));
const isVerb = (w: string) => VERB_STEMS.has(stem(w));
const contentStems = (s: string) => new Set(words(s).map(stem).filter((w) => w.length > 2 && !STOP.has(w)));
const hasNumber = (s: string) => NUMBER.test(s) || NUMBER_WORDS.test(s);
const phraseHits = (text: string, list: string[]) => list.filter((p) => new RegExp(`(?:^|[^a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z])`, "i").test(text));
const share = (n: number, d: number) => (d === 0 ? 0 : n / d);

const SHORT_OK = new Set(["a", "an", "as", "at", "by", "do", "go", "if", "in", "is", "it", "no", "of", "on", "or", "so", "to", "up", "us", "we", "be", "my", "hr", "ok", "vs", "id", "qa", "it"]);
const REAL_ODDITIES = new Set(["queue", "queues", "area", "areas", "idea", "ideas", "audio", "video", "ratio", "radio", "email", "emails", "issue", "issues", "review", "reviews", "audience", "outcome", "outcomes"]);

/** Does this word look like a word? true / false, or null for a figure or symbol that says nothing either way. Shape rules only, not a dictionary:
 *  a vowel, no letter three times running, no q without u, no long runs of consonants, not almost all vowels, no letters mixed into numbers. */
function plausibleWord(raw: string): boolean | null {
  const t = raw.replace(/^[^A-Za-z0-9₦$€£%]+|[^A-Za-z0-9%]+$/g, "");
  if (!t) return null;
  if (/^[₦$€£]?\d[\d.,]*(%|k|m|bn|st|nd|rd|th)?$/i.test(t)) return null;
  if (/^[A-Z]{2,8}\d{0,3}$/.test(t) || /^[QqWw]\d{1,2}$/.test(t)) return true;          // an acronym or a quarter / week label
  const w = t.toLowerCase();
  if (!/^[a-z'’-]+$/.test(w)) return false;                                              // letters mixed into digits: "rr2", "r2ttt11"
  if (SHORT_OK.has(w) || STOP.has(w) || REAL_ODDITIES.has(w) || isVerb(w)) return true;
  const l = w.replace(/[^a-z]/g, "");
  if (l.length < 3) return false;
  if (/(.)/.test(l)) return false;
  if (/q(?!u)/.test(l)) return false;
  const vowels = (l.match(/[aeiouy]/g) ?? []).length;
  if (vowels === 0) return false;
  if (/[^aeiouy]{6,}/.test(l)) return false;
  if (l.length === 3 && vowels === 3) return false;
  if (l.length >= 4 && vowels / l.length > 0.75) return false;
  return true;
}
/** The share of a text's words that look like words (0 when there are none). */
function readability(text: string): number {
  const marks = text.split(/\s+/).map(plausibleWord).filter((m): m is boolean => m !== null);
  return marks.length === 0 ? 0 : marks.filter(Boolean).length / marks.length;
}

export function evaluateSmart(input: SmartInput): SmartEvaluation {
  const title = input.title.trim();
  const description = (input.description ?? "").trim();
  const everything = `${title} ${description}`;
  const titleWords = words(title);
  const warnings: string[] = [];
  const suggestions: string[] = [];
  const firstWord = titleWords[0] ?? "";
  const startsWithVerb = isVerb(firstWord);
  const verbElsewhere = !startsWithVerb && titleWords.slice(1, 6).some(isVerb);
  const vagueInTitle = phraseHits(title, VAGUE_PHRASES);

  // ------------------------------------------------------------ Specific
  let specific = 15;
  if (startsWithVerb) specific += 25; else if (verbElsewhere) specific += 10;
  const bodyWords = titleWords.length - (startsWithVerb ? 1 : 0);
  if (bodyWords >= 2) specific += 12;                                   // a deliverable follows the verb
  if (titleWords.length >= 5) specific += 8;
  if (titleWords.length >= 8 && titleWords.length <= 28) specific += 8;  // enough detail, not a paragraph
  if (titleWords.length > 35) specific -= 10;
  if (/\b(to|for|with|from|across|between)\s+\S+/i.test(title)) specific += 6;   // an audience or counterpart
  if (titleWords.slice(1).some((w) => /^[A-Z][a-z]/.test(w))) specific += 5;     // a named party, system or place
  if (description && readability(description) >= 0.8 && words(description).length >= 6) specific += 6;   // a sentence of context makes the goal clearer
  specific -= vagueInTitle.length * 14;
  if (specific < 70) {
    warnings.push(!startsWithVerb && !verbElsewhere ? "The goal does not begin with an action." : "The goal wording is not very specific.");
    suggestions.push(`Start with an action verb and name the deliverable and who it is for, for example “Publish the Q4 pricing sheet to all sales leads”.`);
  }
  if (vagueInTitle.length) suggestions.push(`Replace vague wording (${vagueInTitle.join(", ")}) with the exact outcome.`);

  // ------------------------------------------------------------ Measurable
  let measurable = 12;
  const numTitle = hasNumber(title);
  if (numTitle) measurable += 40; else if (hasNumber(everything)) measurable += 20;
  if (UNITS.test(title)) measurable += 14; else if (UNITS.test(everything)) measurable += 6;
  if (TARGET_WORDS.test(everything)) measurable += 12;
  if (!numTitle && /\b(all|every|each|both|none|zero)\b/i.test(title)) measurable += 12;   // a whole set is a measure too
  if (VERIFIABLE.some((v) => new RegExp(`\b${v}\b`, "i").test(title)) || (startsWithVerb && [...OUTCOME_VERB_STEMS].some((v) => stem(v) === stem(firstWord)))) measurable += 8;   // an outcome someone can check
  if (/\b(report|document|deck|plan|policy|proposal|contract|dashboard|module|checklist|tracker|sheet|template)s?\b/i.test(title)) measurable += 8;   // a finished artefact can be inspected
  if (measurable < 70) {
    warnings.push("No clear measure of success was found.");
    suggestions.push("Say how many, how much or what share, so completion can be checked, for example “close 5 invoices” or “reduce churn to 3%”.");
  }

  // ------------------------------------------------------------ Achievable
  // the scope the goal's own words claim, and whether it fits one reporting week
  let achievable = titleWords.length < 3 ? 52 : titleWords.length < 5 ? 68 : 82;
  const inflators = phraseHits(title, SCOPE_INFLATORS);
  achievable -= Math.min(2, inflators.length) * 8;
  if (phraseHits(everything, LONG_HORIZON).length) achievable -= 12;
  if (titleWords.length > 40) achievable -= 10;
  if (hasNumber(title) && UNITS.test(title)) achievable += 6;            // a stated size is a scope someone can judge
  if (hasNumber(title) && /(\d{3,}|\d+\s?(?:k|m|bn))/i.test(title) && !/(20\d\d)/.test(title)) achievable -= 4;   // a very large figure for one week
  if (achievable < 70) {
    warnings.push(titleWords.length < 5 ? "The goal is too short to judge whether it fits one week." : "The scope may be too big for one reporting week.");
    suggestions.push(titleWords.length < 5 ? "Say what will be done, how much and for whom, so the size of the goal is clear."
      : "Narrow the goal to what can be finished within one reporting week; avoid “all”, “every” and “always” unless they are bounded.");
  }

  // ------------------------------------------------------------ Relevant
  let relevant: number;
  let tip: string | null = null;
  if (input.goalType === "STRETCH") {
    relevant = 62;
    if (!input.subKrTitle && hasNumber(title)) relevant += 4;
  } else if (!input.subKrTitle) {
    relevant = 30;
  } else {
    // the person chose this Sub-KR, which is an explicit claim of relevance, so a mapped goal starts at 72; sharing the Sub-KR's own key words raises it
    const subStems = contentStems(input.subKrTitle);
    const mine = contentStems(`${title} ${description}`);
    const matched = [...subStems].filter((s) => mine.has(s)).length;
    const need = Math.max(2, Math.ceil(subStems.size * 0.5));
    relevant = 72 + Math.round(Math.min(1, matched / need) * 28);
    if (matched === 0) tip = `The wording shares nothing with the Sub-KR “${input.subKrTitle}”. Name what the goal contributes to it.`;
  }
  relevant = clamp(relevant);
  if (tip) suggestions.push(tip);
  if (relevant < 70) {
    warnings.push(input.goalType === "STRETCH" ? "Stretch goals are not linked to a Sub-KR." : "The goal's link to its Sub-KR is not obvious from the wording.");
    suggestions.push(input.goalType === "STRETCH" ? "Confirm no available Sub-KR applies; otherwise map the goal to one."
      : `Use the Sub-KR's own key words (“${input.subKrTitle ?? ""}”) in the goal so the strategic link is explicit.`);
  }

  // ------------------------------------------------------------ Time-bound
  let timeBound = 18;
  if (EXACT_MOMENT.test(title)) timeBound += 62; else if (GENERAL_TIME.test(title)) timeBound += 38;
  else if (EXACT_MOMENT.test(everything)) timeBound += 40; else if (GENERAL_TIME.test(everything)) timeBound += 22;
  if (EXACT_MOMENT.test(title) && /\b(by|before|until|on|at)\b/i.test(title)) timeBound += 8;     // a deadline, not just a mention of a day
  if (/\b(soon|later|asap|when possible|eventually)\b/i.test(title)) timeBound -= 15;
  if (timeBound < 70) {
    warnings.push(EXACT_MOMENT.test(everything) ? "The deadline is not tied to the goal itself." : "No deadline or timeframe was found.");
    suggestions.push("State the moment it will be done, for example “by Friday 17:00” or “before the next OKR session”.");
  }

  // the title has to read as language: below 80% real-looking words every score is scaled down, to a quarter at 40% or less
  const read = readability(title);
  const scale = read >= 0.8 ? 1 : read <= 0.4 ? 0.25 : 0.25 + ((read - 0.4) / 0.4) * 0.75;
  if (scale < 1) {
    warnings.unshift("The goal title does not read as plain wording, so its scores are reduced.");
    suggestions.unshift("Write the goal as a short sentence in plain words: an action, what it delivers, how much, and by when.");
  }
  const dims = { specific: clamp(specific * scale), measurable: clamp(measurable * scale), achievable: clamp(achievable * scale), relevant: clamp(relevant * scale), timeBound: clamp(timeBound * scale) };
  const overall = Math.round(((dims.specific + dims.measurable + dims.achievable + dims.relevant + dims.timeBound) / 5) * 100) / 100;
  return { ...dims, overall, warnings, suggestions, engineVersion: SMART_ENGINE_VERSION };
}
