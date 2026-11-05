"use client";

import { useState } from "react";
import { apiRequest, useAction } from "@/components/ui/client";

const field = "rounded-lg border border-line bg-panel px-3 py-1.5 text-sm";
const save = "rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50";
const quiet = "rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium hover:bg-surface disabled:opacity-50";

/** One setting: its label, what it does, and a control that fits its kind. Saving needs a recent second factor and is audited with the old and new value. */
export function SettingRow({ k, label, help, kind, value }: { k: string; label: string; help: string | null; kind: "boolean" | "number" | "string"; value: boolean | number | string }) {
  const { run, pending } = useAction();
  const [v, setV] = useState<string>(String(value));
  const changed = v !== String(value);
  const parsed = kind === "boolean" ? v === "true" : kind === "number" ? Number(v) : v;
  const invalid = kind === "number" && (v.trim() === "" || !Number.isFinite(Number(v)) || Number(v) < 0);
  return (
    <li className="grid gap-2 px-6 py-3 md:grid-cols-[1fr_16rem_auto] md:items-center">
      <div><label htmlFor={`s-${k}`} className="text-sm font-medium">{label}</label>{help ? <p className="text-xs text-muted">{help}</p> : null}</div>
      {kind === "boolean" ? (
        <select id={`s-${k}`} className={field} value={v} onChange={(e) => setV(e.target.value)}><option value="true">Yes</option><option value="false">No</option></select>
      ) : <input id={`s-${k}`} className={field} value={v} inputMode={kind === "number" ? "decimal" : undefined} onChange={(e) => setV(e.target.value)} />}
      <button type="button" className={save} disabled={pending || !changed || invalid} onClick={() => run(() => apiRequest("POST", "ai/admin/settings", { key: k, value: parsed }), { success: "Saved." })}>Save</button>
    </li>
  );
}

/** Switching the module on or off. It is one setting, set apart because it changes what the whole module does. */
export function EnableSwitch({ enabled }: { enabled: boolean }) {
  const { run, pending } = useAction();
  return (
    <button type="button" disabled={pending} className={enabled ? quiet : save}
      onClick={() => run(() => apiRequest("POST", "ai/admin/settings", { key: "enabled", value: !enabled }), { success: enabled ? "4COREPAL is switched off." : "4COREPAL is switched on." })}>
      {enabled ? "Switch 4COREPAL off" : "Switch 4COREPAL on"}
    </button>
  );
}

const MODES = [["AUTO", "Automatic"], ["NEEDS_APPROVAL", "Needs approval"], ["DISABLED", "Switched off"]] as const;
/** What the agent may do for one kind of action. A high-impact action cannot be automatic: that choice is not offered, and the database refuses it too. */
export function PolicyRow({ action, label, risk, mode }: { action: string; label: string; risk: "LOW" | "MEDIUM" | "HIGH"; mode: string }) {
  const { run, pending } = useAction();
  const [v, setV] = useState(mode);
  return (
    <tr>
      <td className="font-medium">{label}</td><td className="text-muted">{risk === "LOW" ? "Low" : risk === "MEDIUM" ? "Medium" : "High impact"}</td>
      <td><label className="sr-only" htmlFor={`p-${action}`}>{label}</label>
        <select id={`p-${action}`} className={field} value={v} onChange={(e) => setV(e.target.value)}>{MODES.filter(([m]) => risk !== "HIGH" || m !== "AUTO").map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></td>
      <td><button type="button" className={save} disabled={pending || v === mode} onClick={() => run(() => apiRequest("POST", "ai/admin/policies", { action, mode: v }), { success: "Saved." })}>Save</button></td>
    </tr>
  );
}

const AUDIENCE = [["BU_LEAD", "The unit's leads"], ["AFFECTED_BU_LEADS", "Every affected unit's leads"], ["EXECUTIVES", "The executives"]] as const;
export function EscalationStep({ severity, step, audience, afterHours, isNew }: { severity: string; step: number; audience: string; afterHours: number; isNew?: boolean }) {
  const { run, pending } = useAction();
  const [a, setA] = useState(audience);
  const [h, setH] = useState(String(afterHours));
  const [s, setS] = useState(String(step));
  const hours = Number(h), stepNo = Number(s);
  const invalid = !Number.isInteger(hours) || hours < 0 || hours > 720 || !Number.isInteger(stepNo) || stepNo < 1 || stepNo > 5;
  const body = { severity, step: stepNo, audience: a, afterHours: hours };
  return (
    <li className="grid gap-2 px-6 py-2 sm:grid-cols-[5rem_1fr_9rem_auto_auto] sm:items-center">
      {isNew ? <input aria-label={`New ${severity} step number`} className={field} value={s} onChange={(e) => setS(e.target.value)} /> : <span className="text-sm text-muted">Step {step}</span>}
      <select aria-label={`${severity} step ${step} audience`} className={field} value={a} onChange={(e) => setA(e.target.value)}>{AUDIENCE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <label className="flex items-center gap-2 text-xs text-muted"><input aria-label={`${severity} step ${step} hours`} className={`${field} w-20`} value={h} onChange={(e) => setH(e.target.value)} />hours</label>
      <button type="button" className={save} disabled={pending || invalid || (!isNew && a === audience && h === String(afterHours))} onClick={() => run(() => apiRequest("POST", "ai/admin/escalation", body), { success: "Saved." })}>{isNew ? "Add step" : "Save"}</button>
      {isNew ? <span /> : <button type="button" className={quiet} disabled={pending} onClick={() => run(() => apiRequest("DELETE", "ai/admin/escalation", { severity, step }), { success: "Step removed." })}>Remove</button>}
    </li>
  );
}
