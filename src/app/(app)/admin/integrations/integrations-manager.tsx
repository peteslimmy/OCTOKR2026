"use client";

import { useMemo, useState } from "react";
import { apiRequest, Modal, useAction } from "@/components/ui/client";
import { Badge, Banner, Button, Field, Input, NativeSelect, Select, Textarea } from "@/components/ui/primitives";
import type { IntegrationKind, IntegrationView, SettingField, Slot, TestResult } from "@/lib/integrations/types";

const SLOTS: { slot: Slot; title: string; blurb: string }[] = [
  { slot: "EMAIL", title: "Email", blurb: "Sends reminders and security messages. One email service is used at a time." },
  { slot: "AI", title: "AI providers", blurb: "The connection to an AI service, used by 4COREPAL when that module is switched on. One is used at a time. OpenRouter, NVIDIA, Google Gemini and most other services are added as “OpenAI-compatible”." },
  { slot: "WEBHOOK", title: "Webhooks", blurb: "Posts audit-log events, signed, to another system or to a Slack or Teams channel." },
];

/** Well-known OpenAI-compatible services: they only fill in the address. The model and the key are always the administrator's. */
const AI_PRESETS = [
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { label: "NVIDIA", baseUrl: "https://integrate.api.nvidia.com/v1" },
  { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
];

const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(iso)) : "never");

/** A short line saying what the integration points at, without any secret. */
function summary(i: IntegrationView): string {
  const s = i.settings as Record<string, string | number | string[]>;
  if (i.kind === "SMTP") return `${s.host}:${s.port} · ${s.security} · from ${s.fromAddress}`;
  if (i.kind === "WEBHOOK") return `${s.url} · ${s.format} · ${(s.events as string[] | undefined)?.join(", ") ?? "*"}`;
  return `${s.baseUrl ?? "default address"} · model ${s.model}`;
}

type Mode = { kind: "add"; slot: Slot } | { kind: "edit"; item: IntegrationView } | { kind: "delete"; item: IntegrationView };

export function IntegrationsManager({ kinds, items, canConfigure, canTest, canApplyNow, encryptionConfigured }: {
  kinds: IntegrationKind[]; items: IntegrationView[]; canConfigure: boolean; canTest: boolean; canApplyNow: boolean; encryptionConfigured: boolean;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [kindCode, setKindCode] = useState("");
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [sendMail, setSendMail] = useState(true);
  const [sendTo, setSendTo] = useState("");
  const [applyNow, setApplyNow] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [rowResult, setRowResult] = useState<Record<string, TestResult>>({});
  const { run, pending } = useAction();

  const kind = kinds.find((k) => k.code === kindCode) ?? null;
  const existing = mode?.kind === "edit" ? mode.item : null;

  const asText = (f: SettingField, v: unknown) => (Array.isArray(v) ? v.join(", ") : v === undefined || v === null ? "" : String(v));
  const open = (m: Mode) => {
    setMode(m); setResult(null); setReason(""); setSecrets({}); setRemoved({}); setSendMail(true); setApplyNow(false);
    if (m.kind === "add") {
      const k = kinds.find((x) => x.slot === m.slot) ?? null;
      pick(k?.code ?? "", kinds);
      setName(""); setEnabled(false);
    } else if (m.kind === "edit") {
      const k = kinds.find((x) => x.code === m.item.kind)!;
      setKindCode(k.code); setName(m.item.name); setEnabled(m.item.enabled);
      setSettings(Object.fromEntries(k.setting_fields.map((f) => [f.key, asText(f, m.item.settings[f.key])])));
    }
  };
  function pick(code: string, all: IntegrationKind[]) {
    setKindCode(code);
    const k = all.find((x) => x.code === code);
    setSettings(Object.fromEntries((k?.setting_fields ?? []).map((f) => [f.key, asText(f, f.default)])));
  }

  /** What the form holds, in the shape the API takes: numbers as numbers, lists as lists, empty optional fields left out. */
  const payloadSettings = () => {
    const out: Record<string, unknown> = {};
    for (const f of kind?.setting_fields ?? []) {
      const raw = (settings[f.key] ?? "").trim();
      if (raw === "") continue;
      out[f.key] = f.type === "number" ? Number(raw) : f.type === "tags" ? raw.split(/[,\s]+/).filter(Boolean) : raw;
    }
    return out;
  };
  const payloadSecrets = () => {
    const out: Record<string, string | null> = {};
    for (const f of kind?.secret_fields ?? []) {
      if (removed[f.key]) out[f.key] = null;
      else if ((secrets[f.key] ?? "").trim() !== "") out[f.key] = secrets[f.key];
    }
    return out;
  };

  const test = async () => {
    setTesting(true); setResult(null);
    try {
      const typed = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v.trim() !== ""));
      setResult(await apiRequest<TestResult>("POST", "integrations/test", { id: existing?.id, kind: kindCode, settings: payloadSettings(), secrets: typed, sendMail, sendTo: sendTo.trim() || undefined }));
    } catch (e) { setResult({ ok: false, message: (e as Error).message }); }
    finally { setTesting(false); }
  };

  const submit = async () => {
    if (!mode) return;
    const body = mode.kind === "delete" ? { action: "DELETE", id: mode.item.id, reason }
      : { action: mode.kind === "add" ? "CREATE" : "UPDATE", id: existing?.id, kind: kindCode, name, enabled, settings: payloadSettings(), secrets: payloadSecrets(), reason };
    const ok = await run(() => apiRequest("POST", "integrations/request", { ...body, applyNow: applyNow || undefined }), { success: applyNow ? "Saved and applied. Use Test to confirm it works." : "Sent for approval. A Super Admin must approve changes to integrations." });
    if (ok) setMode(null);
  };

  /** Switching on or off keeps every setting and secret as it is. */
  const toggle = async (i: IntegrationView) => {
    await run(() => apiRequest("POST", "integrations/request", { action: "UPDATE", id: i.id, name: i.name, enabled: !i.enabled, settings: i.settings, reason: `${i.enabled ? "Switch off" : "Switch on"} ${i.name}` }),
      { success: "Sent for approval. A Super Admin must approve changes to integrations." });
  };
  const testSaved = async (i: IntegrationView) => {  // sends a real test message to the signed-in person
    setRowResult((r) => ({ ...r, [i.id]: { ok: true, message: "Testing…" } }));
    try { const out = await apiRequest<TestResult>("POST", "integrations/test", { id: i.id, sendMail: true }); setRowResult((r) => ({ ...r, [i.id]: out })); }
    catch (e) { setRowResult((r) => ({ ...r, [i.id]: { ok: false, message: (e as Error).message } })); }
  };

  const slotKinds = (slot: Slot) => kinds.filter((k) => k.slot === slot);
  const addKinds = mode?.kind === "add" ? slotKinds(mode.slot) : [];
  const valid = useMemo(() => {
    if (mode?.kind === "delete") return reason.trim() !== "";
    if (!kind || !name.trim() || reason.trim() === "") return false;
    for (const f of kind.setting_fields) if (f.required && (settings[f.key] ?? "").trim() === "") return false;
    for (const f of kind.secret_fields) if (f.required && mode?.kind === "add" && (secrets[f.key] ?? "").trim() === "") return false;
    return true;
  }, [mode, kind, name, reason, settings, secrets]);

  return (
    <div className="space-y-6">
      {!encryptionConfigured ? (
        <Banner tone="warn" title="Passwords and API keys cannot be saved yet">
          This server has no encryption key for secrets. The person who runs the server must set <code>INTEGRATIONS_ENCRYPTION_KEY</code> (32 random bytes, base64) and restart it. Settings without a secret can still be saved.
        </Banner>
      ) : null}

      {SLOTS.map(({ slot, title, blurb }) => {
        const list = items.filter((i) => i.slot === slot);
        return (
          <section key={slot} aria-labelledby={`slot-${slot}`} className="rounded-xl border border-line bg-panel shadow-[var(--shadow-card)]">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-6 py-4">
              <div><h2 id={`slot-${slot}`} className="text-base font-semibold">{title}</h2><p className="mt-1 text-sm text-muted">{blurb}</p></div>
              {canConfigure ? <Button size="sm" onClick={() => open({ kind: "add", slot })}>Add {slot === "EMAIL" ? "email service" : slot === "AI" ? "AI provider" : "webhook"}</Button> : null}
            </header>
            {list.length === 0 ? <p className="px-6 py-4 text-sm text-muted">Nothing configured.</p> : (
              <ul className="divide-y divide-line" aria-label={`${title} integrations`}>
                {list.map((i) => {
                  const r = rowResult[i.id];
                  return (
                    <li key={i.id} className="space-y-2 px-6 py-4 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{i.name}</span>
                        <span className="text-muted">{kinds.find((k) => k.code === i.kind)?.label}</span>
                        <Badge tone={i.enabled ? "done" : "undefined"}>{i.enabled ? "In use" : "Switched off"}</Badge>
                        {i.last_test_at ? <Badge tone={i.last_test_ok ? "done" : "critical"}>{i.last_test_ok ? "Last test passed" : "Last test failed"} · {when(i.last_test_at)}</Badge> : <Badge tone="info">Not tested</Badge>}
                      </div>
                      <p className="break-all text-muted">{summary(i)}</p>
                      {i.secrets_set.length ? <p className="text-xs text-muted">Secrets saved: {i.secrets_set.join(", ")} (never shown)</p> : null}
                      {i.last_test_message && !r ? <p className="text-xs text-muted">{i.last_test_message}</p> : null}
                      {slot === "WEBHOOK" ? <p className="text-xs text-muted">Waiting to send: {i.webhook_pending} · failed: {i.webhook_failed} · last delivered: {when(i.webhook_last_sent_at)}</p> : null}
                      {r ? <p role="status" className={r.ok ? "text-[var(--done-fg)]" : "text-[var(--critical-fg)]"}>{r.message}</p> : null}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {canTest ? <Button size="sm" variant="secondary" onClick={() => testSaved(i)}>Test<span className="sr-only"> {i.name}</span></Button> : null}
                        {canConfigure ? (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => open({ kind: "edit", item: i })}>Edit<span className="sr-only"> {i.name}</span></Button>
                            <Button size="sm" variant="secondary" disabled={pending} onClick={() => toggle(i)}>{i.enabled ? "Switch off" : "Switch on"}<span className="sr-only"> {i.name}</span></Button>
                            <Button size="sm" variant="danger" onClick={() => open({ kind: "delete", item: i })}>Remove<span className="sr-only"> {i.name}</span></Button>
                          </>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <Modal open={mode !== null} onOpenChange={(o) => { if (!o) setMode(null); }}
        title={mode?.kind === "add" ? "Add an integration" : mode?.kind === "edit" ? `Edit ${existing?.name}` : `Remove ${mode?.kind === "delete" ? mode.item.name : ""}`}
        description={mode?.kind === "delete" ? "Nothing is deleted until a Super Admin approves." : "Your request goes to a Super Admin. Nothing changes until it is approved. Secrets are encrypted and never shown again."}>
        <div className="space-y-3">
          {mode?.kind === "delete" ? <p className="text-sm">Events and messages still waiting for this integration are dropped.</p> : (
            <>
              {mode?.kind === "add" && addKinds.length > 1 ? (
                <Field id="int-kind" label="Kind"><Select value={kindCode} onChange={(e) => pick(e.target.value, kinds)}>{addKinds.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}</Select></Field>
              ) : null}
              {kind ? <p className="text-xs text-muted">{kind.description}</p> : null}
              {kind?.code === "OPENAI_COMPATIBLE" && mode?.kind === "add" ? (
                <Field id="int-preset" label="Service" hint="Fills in the API address. You still choose the model and paste your own key.">
                  <Select defaultValue="" onChange={(e) => {
                    const p = AI_PRESETS.find((x) => x.label === e.target.value);
                    if (p) { setSettings((s) => ({ ...s, baseUrl: p.baseUrl })); setName((n) => n || p.label); }
                  }}>
                    <option value="">Other (type the address)</option>
                    {AI_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
                  </Select>
                </Field>
              ) : null}
              <Field id="int-name" label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></Field>
              {kind?.setting_fields.map((f) => (
                <Field key={f.key} id={`int-${f.key}`} label={f.label} required={f.required} hint={f.help}>
                  {f.type === "select"
                    ? <Select value={settings[f.key] ?? ""} onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })}>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</Select>
                    : <Input type={f.type === "number" ? "number" : "text"} value={settings[f.key] ?? ""} onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })} />}
                </Field>
              ))}
              {kind?.secret_fields.map((f) => {
                const isSet = !!existing?.secrets_set.includes(f.key);
                return (
                  <div key={f.key} className="space-y-1">
                    <Field id={`int-s-${f.key}`} label={f.label} required={f.required && !isSet} hint={isSet ? "A value is saved. Leave empty to keep it, or type a new one to replace it." : f.help}>
                      <Input type="password" autoComplete="new-password" value={secrets[f.key] ?? ""} placeholder={isSet ? "•••••••• saved" : ""} onChange={(e) => setSecrets({ ...secrets, [f.key]: e.target.value })} disabled={!encryptionConfigured} />
                    </Field>
                    {isSet && !f.required ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!removed[f.key]} onChange={(e) => setRemoved({ ...removed, [f.key]: e.target.checked })} />Remove the saved {f.label.toLowerCase()}</label> : null}
                  </div>
                );
              })}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Switch it on once approved{kind && kind.slot !== "WEBHOOK" ? " (replaces the one now in use)" : ""}</label>
              {kind?.code === "SMTP" ? (
                <>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sendMail} onChange={(e) => setSendMail(e.target.checked)} />When testing, send a real test message</label>
                  {sendMail ? <Field id="int-sendto" label="Send the test message to" hint="Leave empty to send it to your own address."><Input type="email" value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="name@example.com" /></Field> : null}
                </>
              ) : null}
              {canApplyNow ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={applyNow} onChange={(e) => setApplyNow(e.target.checked)} /><span>Apply now, without a second approver. You will be asked for your authenticator code, the reason must be at least 10 characters, and the change is audited as an emergency change.</span></label> : null}
              {canTest ? (
                <div className="space-y-2">
                  <Button variant="secondary" onClick={test} disabled={testing || !kind}>{testing ? "Testing…" : "Test these values"}</Button>
                  {result ? <p role="status" className={result.ok ? "text-sm text-[var(--done-fg)]" : "text-sm text-[var(--critical-fg)]"}>{result.message}</p> : null}
                </div>
              ) : null}
            </>
          )}
          <Field id="int-reason" label="Reason for the approver"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode(null)}>Cancel</Button>
            <Button variant={mode?.kind === "delete" ? "danger" : "primary"} disabled={pending || !valid || (applyNow && reason.trim().length < 10)} onClick={submit}>{applyNow ? "Save and apply now" : "Send for approval"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
