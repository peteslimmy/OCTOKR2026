/**
 * What stands between recorded text and the model (4COREPAL). Goals, tasks, comments and remarks are written by people; some day one of them will say
 * "ignore your instructions". None of that text is ever an instruction: it reaches the model fenced and labelled as data, stripped of anything that could close
 * the fence, and the model can in any case only ask for allowlisted, scoped tools, so even a model that obeyed it could not reach beyond the asker's permissions.
 */

/** Free text from the database, made safe to place inside a fenced data block. */
export function cleanText(v: unknown, max = 300): string {
  const s = String(v ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")   // control and bidirectional-override characters
    .replace(/[<>]/g, "")                                                                                    // nothing can open or close a tag
    .replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Applies cleanText to every string in a result, keeping its shape. */
export function cleanDeep<T>(value: T, max = 300): T {
  if (typeof value === "string") return cleanText(value, max) as unknown as T;
  if (Array.isArray(value)) return value.map((x) => cleanDeep(x, max)) as unknown as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, cleanDeep(v, max)])) as T;
  return value;
}

/** Wraps a tool result for the model. The nonce is fresh per request, so recorded text cannot guess the closing marker. */
export function fence(nonce: string, tool: string, json: unknown): string {
  return `<data tool="${tool}" nonce="${nonce}" trust="none">\n${JSON.stringify(json)}\n</data nonce="${nonce}">`;
}

/** Tokens that stand for business units while text is with the model, so the provider sees codes and not names (the setting "pseudonymise_prompts"). */
export interface Pseudonymiser {
  /** The code placeholder for a unit; remembers it for restoration. */
  token(code: string, name: string): string;
  /** Replaces every placeholder the model used with the unit's name. Placeholders it invented are left out, never guessed at. */
  restore(text: string): string;
  /** The reverse, for text on its way to the provider (a question, an earlier answer): known unit names become placeholders. */
  scrub(text: string): string;
}
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function pseudonymiser(enabled: boolean): Pseudonymiser {
  const names = new Map<string, string>();
  return {
    token(code, name) { if (!enabled) return name; names.set(code, name); return `[[BU:${code}]]`; },
    restore(text) { return enabled ? text.replace(/\[\[BU:([A-Za-z0-9_-]{1,20})\]\]/g, (_m, c: string) => names.get(c) ?? "a business unit") : text; },
    scrub(text) {
      if (!enabled) return text;
      let t = text;
      for (const [code, name] of [...names].sort((x, y) => y[1].length - x[1].length)) t = t.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi"), `[[BU:${code}]]`);
      return t;
    },
  };
}
