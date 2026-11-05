// Turns an uploaded sheet (already read as plain cells) into the goals a Business Unit Lead is adding to a weekly report.
// One row per task. Columns (names are matched loosely): Goal, Sub-KR, BU goal (the unit goal it supports, by its title), Task. (A Description column is still read if a file has one.)
//   - a row with a Goal starts a new goal; a row with a blank Goal adds another task to the goal above it
//   - Sub-KR is the code (for example KR1.1); leave it blank for a stretch goal
// Nothing here talks to the database: the caller supplies the Sub-KR codes that exist and gets back goals plus every problem found.

export interface UploadedGoal { goalType: "KR_ALIGNED" | "STRETCH"; subKeyResultId: string | null; buGoalId: string | null; title: string; description: string | null; tasks: { description: string }[] }
export interface GoalUploadResult { goals: UploadedGoal[]; errors: string[] }

export const GOAL_UPLOAD_LIMITS = { goals: 100, tasksPerGoal: 50, title: 500, description: 4000, task: 1000 } as const;
export const GOAL_TEMPLATE_HEADERS = ["Goal", "Sub-KR", "BU goal", "Task"] as const;

const find = (headers: string[], re: RegExp) => headers.findIndex((h) => re.test(h.trim()));

export function parseGoalUpload(headers: string[], rows: string[][], subKrByCode: Map<string, string>, buGoals: Map<string, string> = new Map()): GoalUploadResult {
  const errors: string[] = [];
  const iGoal = find(headers, /^goals?$|^goal\s*title$/i), iSub = find(headers, /^sub[\s_-]*(kr|key)/i), iBu = find(headers, /^bu[\s_-]*goal/i), iDesc =find(headers, /^desc/i), iTask = find(headers, /^tasks?$|^task\s*(desc|name|title)/i);
  if (iGoal < 0 || iTask < 0) return { goals: [], errors: ["The first row must have the column headings Goal and Task (Sub-KR and Description are optional)."] };

  const goals: UploadedGoal[] = [];
  let current: UploadedGoal | null = null;
  let currentCode = "";
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const unsafe = (v: string) => v.startsWith("=");     // a formula is data to be refused, never evaluated

  rows.forEach((r, idx) => {
    const line = idx + 2;                              // the sheet's own row number: the header is row 1
    const goal = cell(r, iGoal), sub = cell(r, iSub), bu = cell(r, iBu), desc = cell(r, iDesc), task = cell(r, iTask);
    if (!goal && !sub && !bu && !desc && !task) return;
    for (const v of [goal, sub, bu, desc, task]) if (unsafe(v)) { errors.push(`Row ${line}: a cell starts with "=" (formulas are not accepted).`); return; }

    if (goal) {
      if (goal.length > GOAL_UPLOAD_LIMITS.title) errors.push(`Row ${line}: the goal is longer than ${GOAL_UPLOAD_LIMITS.title} characters.`);
      if (desc.length > GOAL_UPLOAD_LIMITS.description) errors.push(`Row ${line}: the description is longer than ${GOAL_UPLOAD_LIMITS.description} characters.`);
      let subId: string | null = null;
      if (sub) {
        subId = subKrByCode.get(sub.split(/\s+/)[0].toUpperCase()) ?? null;
        if (!subId) errors.push(`Row ${line}: Sub-KR "${sub}" does not exist for this quarter.`);
      }
      currentCode = sub.split(/\s+/)[0].toUpperCase();
      let buId: string | null = null;
      if (bu) {
        buId = buGoals.get(bu.toLowerCase()) ?? null;
        if (!buId) errors.push(`Row ${line}: BU goal "${bu.slice(0, 60)}" is not one of your unit's active goals for this quarter.`);
      } else if (buGoals.size > 0 && sub) errors.push(`Row ${line}: choose which BU goal this supports (the BU goal column).`);
      current = { goalType: sub ? "KR_ALIGNED" : "STRETCH", subKeyResultId: subId, buGoalId: buId, title: goal, description: desc || null, tasks: [] };
      goals.push(current);
    } else if (!current) {
      errors.push(`Row ${line}: a task needs a goal above it.`);
      return;
    } else if (sub && sub.split(/\s+/)[0].toUpperCase() !== currentCode) {
      errors.push(`Row ${line}: leave Sub-KR blank on task rows; it belongs to the goal.`);
    }
    if (task) {
      if (task.length > GOAL_UPLOAD_LIMITS.task) errors.push(`Row ${line}: the task is longer than ${GOAL_UPLOAD_LIMITS.task} characters.`);
      current!.tasks.push({ description: task });
    }
  });

  for (const g of goals) {
    if (g.tasks.length === 0) errors.push(`Goal "${g.title.slice(0, 60)}" has no task.`);
    if (g.tasks.length > GOAL_UPLOAD_LIMITS.tasksPerGoal) errors.push(`Goal "${g.title.slice(0, 60)}" has more than ${GOAL_UPLOAD_LIMITS.tasksPerGoal} tasks.`);
  }
  if (goals.length === 0 && errors.length === 0) errors.push("The file holds no goals.");
  if (goals.length > GOAL_UPLOAD_LIMITS.goals) errors.push(`The file has ${goals.length} goals; add at most ${GOAL_UPLOAD_LIMITS.goals} at a time.`);
  return { goals, errors };
}

/** The template a person downloads: headings and two example goals. */
export function goalTemplateCsv(): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = [
    [...GOAL_TEMPLATE_HEADERS],
    ["Close 5 partner onboarding calls by Friday", "KR2.1", "Grow partner revenue by 20%", "Schedule the five calls by Tuesday"],
    ["", "", "", "Complete the five calls and log outcomes"],
    ["Publish the Q4 pricing sheet to all sales leads by Thursday", "", "", "Draft the pricing sheet"],
    ["", "", "", "Send the sheet to all sales leads"],
  ];
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}
