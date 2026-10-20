/** Shapes shared by the integration screens, routes and adapters (ADR-076). No secrets appear in any of them. */
export type Slot = "EMAIL" | "AI" | "WEBHOOK";

export interface SettingField {
  key: string; label: string; type: "text" | "number" | "url" | "email" | "select" | "tags";
  required?: boolean; help?: string; options?: string[]; min?: number; max?: number; pattern?: string; default?: unknown;
}
export interface SecretField { key: string; label: string; required?: boolean; help?: string }
export interface IntegrationKind { code: string; slot: Slot; label: string; description: string; setting_fields: SettingField[]; secret_fields: SecretField[] }

export interface IntegrationView {
  id: string; kind: string; slot: Slot; name: string; enabled: boolean; settings: Record<string, unknown>; secrets_set: string[]; version: number;
  last_test_at: string | null; last_test_ok: boolean | null; last_test_message: string | null; updated_at: string;
  webhook_pending: number; webhook_failed: number; webhook_last_sent_at: string | null;
}
export interface IntegrationsOverview { kinds: IntegrationKind[]; items: IntegrationView[] }

export interface TestResult { ok: boolean; message: string; ms?: number }

/** What the person typed. A secret that is absent stays as it is; null removes it; a string replaces it. */
export interface IntegrationInput {
  action: "CREATE" | "UPDATE" | "DELETE";
  id?: string;
  kind?: string;
  name?: string;
  enabled?: boolean;
  settings?: Record<string, unknown>;
  secrets?: Record<string, string | null>;
}

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/**
 * The same checks the database makes, run first so the person gets a message per field before anything is sent. The database stays the authority:
 * it repeats every check when the change is asked for and again when it is approved.
 */
export function checkSettings(kind: IntegrationKind, settings: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const known = new Set(kind.setting_fields.map((f) => f.key));
  for (const k of Object.keys(settings)) if (!known.has(k)) problems.push(`Unknown setting: ${k}`);
  for (const f of kind.setting_fields) {
    const v = settings[f.key];
    if (isBlank(v)) { if (f.required) problems.push(`${f.label} is required.`); continue; }
    if (f.type === "number") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) problems.push(`${f.label} must be a whole number${f.min !== undefined && f.max !== undefined ? ` from ${f.min} to ${f.max}` : ""}.`);
    } else if (f.type === "url") {
      if (typeof v !== "string" || !/^https?:\/\/[^\s/$.?#][^\s]*$/.test(v) || v.length > 500) problems.push(`${f.label} must be a web address starting with https://.`);
    } else if (f.type === "email") {
      if (typeof v !== "string" || !/^[^\s<>()",;\\@]+@[^\s<>()",;\\@]+\.[^\s<>()",;\\@]+$/.test(v) || v.length > 254) problems.push(`${f.label} must be one plain email address.`);
    } else if (f.type === "select") {
      if (typeof v !== "string" || !(f.options ?? []).includes(v)) problems.push(`${f.label} must be one of: ${(f.options ?? []).join(", ")}.`);
    } else if (f.type === "tags") {
      const re = f.pattern ? new RegExp(f.pattern) : null;
      if (!Array.isArray(v) || v.length > 50 || v.some((t) => typeof t !== "string" || t.length > 100 || (re && !re.test(t)))) problems.push(`${f.label} has an item that is not allowed.`);
    } else if (typeof v !== "string" || v.length > 300 || /[\r\n\t]/.test(v)) problems.push(`${f.label} must be short plain text.`);
  }
  return problems;
}

/** Fills in the defaults a kind proposes, for a form or for a settings object that left a field out. */
export function withDefaults(kind: IntegrationKind, settings: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...settings };
  for (const f of kind.setting_fields) if (isBlank(out[f.key]) && f.default !== undefined) out[f.key] = f.default;
  return out;
}
