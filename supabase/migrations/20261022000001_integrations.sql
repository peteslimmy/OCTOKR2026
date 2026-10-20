-- Integrations module (ADR-076): email (SMTP), AI providers and outbound webhooks are configured in the application instead of in server files.
--
-- Rules this migration builds in:
--  * The kinds of integration, and the fields each one has, are DATA (integration_kinds): the screen draws its forms from them and the database checks
--    every saved value against them. A new kind needs a row here and an adapter in the web tier, not a new workflow.
--  * Secrets (passwords, API keys, signing secrets) are encrypted by the web tier BEFORE they reach the database (AES-256-GCM, key in the server
--    environment) and are stored only as ciphertext. No browser session can read the table, the read function never returns a secret (only which ones are
--    set), approvers see "changed", and the audit log holds ciphertext at most.
--  * Changing an integration is a configuration change (ADR-068): one person asks, a Super Admin approves (the topic is protected, because redirecting
--    mail or events to another place is a way to take data out), or a Super Admin applies it in an emergency.
--  * Outbound webhooks deliver audit-log events through an outbox with leases, back-off and a give-up, exactly like email.

insert into permissions (code, description, protected) values
  ('integrations.view',      'See which integrations are configured and how their last test went (never the secrets)', false),
  ('integrations.configure', 'Ask for an integration (email, AI provider, webhook) to be added, changed, disabled or removed', true),
  ('integrations.test',      'Test an integration: send a test message to yourself, or a harmless test request to the provider', false);
insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values
  ('ADMIN','integrations.view'), ('ADMIN','integrations.configure'), ('ADMIN','integrations.test'),
  ('SUPER_ADMIN','integrations.view'), ('SUPER_ADMIN','integrations.configure'), ('SUPER_ADMIN','integrations.test')
) v(role_code, perm) join roles r on r.code = v.role_code join permissions p on p.code = v.perm;

-- ------------------------------------------------------------------ the catalogue of kinds
create table integration_kinds (
  code           text primary key,
  slot           text not null check (slot in ('EMAIL','AI','WEBHOOK')),
  label          text not null,
  description    text not null,
  setting_fields jsonb not null,     -- [{key,label,type: text|number|url|email|select|tags, required, help, options, min, max, pattern, default}]
  secret_fields  jsonb not null      -- [{key,label,required,help}]
);
alter table integration_kinds enable row level security;
grant select on integration_kinds to authenticated;
create policy read_all on integration_kinds for select to authenticated using (true);

insert into integration_kinds (code, slot, label, description, setting_fields, secret_fields) values
('SMTP', 'EMAIL', 'Email (SMTP)',
 'Sends reminders and security messages. When one is enabled it is used instead of the server''s EMAIL_* settings.',
 '[{"key":"host","label":"SMTP server","type":"text","required":true,"help":"For example smtp.your-provider.com"},
   {"key":"port","label":"Port","type":"number","required":true,"min":1,"max":65535,"default":587,"help":"587 (STARTTLS) or 465 (TLS) are usual"},
   {"key":"security","label":"Connection security","type":"select","required":true,"options":["STARTTLS","TLS","NONE"],"default":"STARTTLS","help":"NONE sends passwords in the clear: only for a trusted internal relay"},
   {"key":"username","label":"User name","type":"text","required":false},
   {"key":"fromName","label":"Sender name","type":"text","required":false,"default":"4CORE-OKR"},
   {"key":"fromAddress","label":"Sender address","type":"email","required":true,"help":"Must be on a domain you have verified with the provider"},
   {"key":"baseUrl","label":"Address of this application","type":"url","required":true,"help":"Used for the link in each email, for example https://okr.your-domain"}]'::jsonb,
 '[{"key":"password","label":"Password","required":false}]'::jsonb),
('ANTHROPIC', 'AI', 'AI provider: Anthropic Claude',
 'Connects the application to Claude. Nothing in the application sends data to an AI provider yet; this stores and tests the connection for features that will.',
 '[{"key":"model","label":"Model","type":"text","required":true,"default":"claude-sonnet-5-5","help":"For example claude-sonnet-5-5"},
   {"key":"baseUrl","label":"API address","type":"url","required":false,"default":"https://api.anthropic.com","help":"Leave as is unless you use a gateway"}]'::jsonb,
 '[{"key":"apiKey","label":"API key","required":true}]'::jsonb),
('OPENAI_COMPATIBLE', 'AI', 'AI provider: OpenAI-compatible',
 'Any service that speaks the OpenAI chat-completions protocol (OpenAI, Azure OpenAI, a gateway, a self-hosted model). Nothing sends data to it yet; this stores and tests the connection.',
 '[{"key":"baseUrl","label":"API address","type":"url","required":true,"help":"For example https://api.openai.com/v1"},
   {"key":"model","label":"Model","type":"text","required":true}]'::jsonb,
 '[{"key":"apiKey","label":"API key","required":false,"help":"Some self-hosted services need none"}]'::jsonb),
('WEBHOOK', 'WEBHOOK', 'Webhook (outbound events)',
 'Posts audit-log events to a web address you choose, signed so the receiver can check they came from this application. Works with any service that accepts a webhook, including Slack and Microsoft Teams incoming webhooks (choose the text format).',
 '[{"key":"url","label":"Address that receives the events","type":"url","required":true,"help":"HTTPS in production"},
   {"key":"events","label":"Which events","type":"tags","required":true,"pattern":"^(\\*|[A-Z][A-Z0-9_]*\\*?)$","default":["*"],"help":"* for all, or names such as ROLE_CREATED or a prefix such as CONFIG_CHANGE_*"},
   {"key":"format","label":"Format","type":"select","required":true,"options":["JSON","TEXT"],"default":"JSON","help":"TEXT sends {\"text\": \"...\"}, which Slack and Teams accept"}]'::jsonb,
 '[{"key":"signingSecret","label":"Signing secret","required":false,"help":"Used to sign each delivery (HMAC-SHA256). Strongly recommended."}]'::jsonb);

-- ------------------------------------------------------------------ the integrations
create table integrations (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null references integration_kinds(code),
  slot              text not null,
  name              text not null check (char_length(btrim(name)) between 1 and 100),
  enabled           boolean not null default false,
  settings          jsonb not null default '{}'::jsonb,
  secrets           jsonb not null default '{}'::jsonb,       -- field -> ciphertext ("v1.<key id>.<iv>.<tag>.<data>"); never plain text
  version           int not null default 1,
  last_test_at      timestamptz,
  last_test_ok      boolean,
  last_test_message text,
  created_by        uuid references users(id),
  updated_by        uuid references users(id),
  created_at        timestamptz not null default app_now(),
  updated_at        timestamptz not null default app_now()
);
create unique index integrations_kind_name on integrations (kind, lower(name));
-- one email service and one AI provider in use at a time; any number of webhooks
create unique index integrations_one_enabled_per_slot on integrations (slot) where enabled and slot in ('EMAIL','AI');
alter table integrations enable row level security;           -- no policy and no grant: people read through read_integrations(), which never returns a secret

-- ------------------------------------------------------------------ checking a proposed integration against its kind
create or replace function validate_integration_payload(p_kind text, p_settings jsonb, p_secrets jsonb, p_creating boolean) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare k integration_kinds; f jsonb; v_key text; v_val jsonb; v_text text; v_n numeric; e jsonb;
begin
  select * into k from integration_kinds where code = p_kind;
  if not found then raise exception 'VALIDATION_ERROR' using detail = 'unknown kind of integration'; end if;
  if jsonb_typeof(coalesce(p_settings, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_secrets, '{}'::jsonb)) <> 'object' then raise exception 'VALIDATION_ERROR' using detail = 'settings and secrets must be objects'; end if;
  for v_key in select jsonb_object_keys(coalesce(p_settings, '{}'::jsonb)) loop
    if not exists (select 1 from jsonb_array_elements(k.setting_fields) x where x->>'key' = v_key) then raise exception 'VALIDATION_ERROR' using detail = 'unknown setting ' || left(v_key, 40); end if;
  end loop;
  for f in select * from jsonb_array_elements(k.setting_fields) loop
    v_key := f->>'key'; v_val := coalesce(p_settings, '{}'::jsonb)->v_key;
    if v_val is null or v_val = 'null'::jsonb or (jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') = '') or (jsonb_typeof(v_val) = 'array' and jsonb_array_length(v_val) = 0) then
      if coalesce((f->>'required')::boolean, false) then raise exception 'VALIDATION_ERROR' using detail = (f->>'label') || ' is required'; end if;
      continue;
    end if;
    case f->>'type'
      when 'number' then
        if jsonb_typeof(v_val) <> 'number' then raise exception 'VALIDATION_ERROR' using detail = (f->>'label') || ' must be a number'; end if;
        v_n := (v_val #>> '{}')::numeric;
        if v_n <> trunc(v_n) or (f ? 'min' and v_n < (f->>'min')::numeric) or (f ? 'max' and v_n > (f->>'max')::numeric) then raise exception 'VALIDATION_ERROR' using detail = (f->>'label') || ' is outside the allowed range'; end if;
      when 'url' then
        v_text := v_val #>> '{}';
        if jsonb_typeof(v_val) <> 'string' or v_text !~ '^https?://[^\s/$.?#][^\s]*$' or length(v_text) > 500 then raise exception 'VALIDATION_ERROR' using detail = (f->>'label') || ' must be a web address starting with https://'; end if;
      when 'email' then
        v_text := v_val #>> '{}';
        if jsonb_typeof(v_val) <> 'string' or v_text !~ '^[^\s<>()",;\\@]+@[^\s<>()",;\\@]+\.[^\s<>()",;\\@]+$' or length(v_text) > 254 then raise exception 'VALIDATION_ERROR' using detail = (f->>'label') || ' must be one plain email address'; end if;
      when 'select' then
        if jsonb_typeof(v_val) <> 'string' or not (f->'options') @> to_jsonb(v_val #>> '{}') then raise exception 'VALIDATION_ERROR' using detail = (f->>'label') || ' is not one of the allowed choices'; end if;
      when 'tags' then
        if jsonb_typeof(v_val) <> 'array' or jsonb_array_length(v_val) > 50 then raise exception 'VALIDATION_ERROR' using detail = (f->>'label') || ' must be a list of at most 50 items'; end if;
        for e in select * from jsonb_array_elements(v_val) loop
          if jsonb_typeof(e) <> 'string' or length(e #>> '{}') > 100 or (f ? 'pattern' and (e #>> '{}') !~ (f->>'pattern')) then raise exception 'VALIDATION_ERROR' using detail = (f->>'label') || ' has an item that is not allowed: ' || left(e #>> '{}', 40); end if;
        end loop;
      else
        if jsonb_typeof(v_val) <> 'string' or length(v_val #>> '{}') > 300 or (v_val #>> '{}') ~ '[\r\n\t]' then raise exception 'VALIDATION_ERROR' using detail = (f->>'label') || ' must be short plain text'; end if;
    end case;
  end loop;
  -- secrets arrive already encrypted: anything that is not ciphertext is refused, so a plain password can never be stored by mistake
  for v_key in select jsonb_object_keys(coalesce(p_secrets, '{}'::jsonb)) loop
    if not exists (select 1 from jsonb_array_elements(k.secret_fields) x where x->>'key' = v_key) then raise exception 'VALIDATION_ERROR' using detail = 'unknown secret ' || left(v_key, 40); end if;
    v_val := p_secrets->v_key;
    if v_val <> 'null'::jsonb and (jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' or length(v_val #>> '{}') > 4000) then
      raise exception 'VALIDATION_ERROR' using detail = 'a secret reached the database without being encrypted';
    end if;
  end loop;
  if p_creating then
    for f in select * from jsonb_array_elements(k.secret_fields) loop
      if coalesce((f->>'required')::boolean, false) and (coalesce(p_secrets, '{}'::jsonb)->(f->>'key') is null or p_secrets->(f->>'key') = 'null'::jsonb) then
        raise exception 'VALIDATION_ERROR' using detail = (f->>'label') || ' is required';
      end if;
    end loop;
  end if;
end $$;

-- ------------------------------------------------------------------ the approved change
create or replace function integration_current(p_target text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('kind', i.kind, 'name', i.name, 'enabled', i.enabled, 'settings', i.settings,
                            'secretsSet', coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(i.secrets) k), '[]'::jsonb), 'version', i.version)
    from integrations i where p_target is not null and i.id::text = p_target;
$$;

create or replace function apply_integration_change(r config_change_requests) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p jsonb := r.proposed; v_action text := p->>'action'; v_actor uuid := r.requested_by; v_kind text := p->>'kind'; v_name text := btrim(coalesce(p->>'name', ''));
  v_settings jsonb := coalesce(p->'settings', '{}'::jsonb); v_secrets jsonb := coalesce(p->'secrets', '{}'::jsonb); v_enabled boolean := coalesce((p->>'enabled')::boolean, false);
  i integrations; v_id uuid; v_slot text; v_key text; v_changed text[] := '{}'; v_merged jsonb;
begin
  perform require_permission(v_actor, 'integrations.configure');
  if v_action not in ('CREATE','UPDATE','DELETE') then raise exception 'VALIDATION_ERROR' using detail = 'action must be CREATE, UPDATE or DELETE'; end if;
  if v_action = 'CREATE' then
    if v_name = '' or length(v_name) > 100 then raise exception 'VALIDATION_ERROR' using detail = 'give the integration a name of up to 100 characters'; end if;
    perform validate_integration_payload(v_kind, v_settings, v_secrets, true);
    select slot into v_slot from integration_kinds where code = v_kind;
    begin
      insert into integrations (kind, slot, name, enabled, settings, secrets, created_by, updated_by)
        values (v_kind, v_slot, v_name, v_enabled, v_settings, (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(v_secrets) e(k, v) where v <> 'null'::jsonb), v_actor, v_actor) returning id into v_id;
    exception when unique_violation then
      raise exception 'VALIDATION_ERROR' using detail = case when exists (select 1 from integrations where kind = v_kind and lower(name) = lower(v_name))
        then 'an integration of this kind already has that name' else 'another ' || v_slot || ' integration is already enabled: disable it first, or save this one switched off' end;
    end;
    select array_agg(k) into v_changed from jsonb_object_keys(v_secrets) k;
    perform write_audit(v_actor, 'INTEGRATION_CREATED', 'integration', v_id::text, null,
      jsonb_build_object('kind', v_kind, 'name', v_name, 'enabled', v_enabled, 'settings', v_settings, 'secrets_set', coalesce(v_changed, '{}')), r.reason);
    return;
  end if;

  select * into i from integrations where id::text = r.target for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_action = 'DELETE' then
    delete from integrations where id = i.id;
    perform write_audit(v_actor, 'INTEGRATION_DELETED', 'integration', i.id::text, jsonb_build_object('kind', i.kind, 'name', i.name, 'enabled', i.enabled), null, r.reason);
    return;
  end if;
  -- UPDATE: the kind never changes; settings are replaced as a whole; secrets are changed one by one (absent = keep, null = remove, text = replace)
  if v_kind is not null and v_kind <> i.kind then raise exception 'VALIDATION_ERROR' using detail = 'the kind of an integration cannot change'; end if;
  if v_name = '' or length(v_name) > 100 then raise exception 'VALIDATION_ERROR' using detail = 'give the integration a name of up to 100 characters'; end if;
  perform validate_integration_payload(i.kind, v_settings, v_secrets, false);
  v_merged := i.secrets;
  for v_key in select jsonb_object_keys(v_secrets) loop
    if v_secrets->v_key = 'null'::jsonb then
      if exists (select 1 from integration_kinds k, jsonb_array_elements(k.secret_fields) f where k.code = i.kind and f->>'key' = v_key and coalesce((f->>'required')::boolean, false)) then
        raise exception 'VALIDATION_ERROR' using detail = 'a required secret cannot be removed; replace it instead';
      end if;
      v_merged := v_merged - v_key;
    else v_merged := v_merged || jsonb_build_object(v_key, v_secrets->v_key); end if;
    v_changed := v_changed || v_key;
  end loop;
  begin
    update integrations set name = v_name, enabled = v_enabled, settings = v_settings, secrets = v_merged, version = version + 1, updated_by = v_actor, updated_at = app_now(),
           last_test_at = case when v_changed <> '{}' or settings is distinct from v_settings then null else last_test_at end,
           last_test_ok = case when v_changed <> '{}' or settings is distinct from v_settings then null else last_test_ok end,
           last_test_message = case when v_changed <> '{}' or settings is distinct from v_settings then null else last_test_message end
     where id = i.id;
  exception when unique_violation then
    raise exception 'VALIDATION_ERROR' using detail = case when exists (select 1 from integrations where kind = i.kind and lower(name) = lower(v_name) and id <> i.id)
      then 'an integration of this kind already has that name' else 'another ' || i.slot || ' integration is already enabled: disable it first' end;
  end;
  perform write_audit(v_actor, 'INTEGRATION_UPDATED', 'integration', i.id::text,
    jsonb_build_object('name', i.name, 'enabled', i.enabled, 'settings', i.settings),
    jsonb_build_object('name', v_name, 'enabled', v_enabled, 'settings', v_settings, 'secrets_changed', v_changed), r.reason);
end $$;

insert into config_change_topics (code, description, request_permission, approve_permission, protected, applier, current_fn)
values ('INTEGRATION', 'Add, change, switch on or off, or remove an integration (email, AI provider, webhook)', 'integrations.configure', 'config.approve', true, 'apply_integration_change', 'integration_current');

-- ------------------------------------------------------------------ what the screen may read: never a secret
create or replace function read_integrations() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (select auth_has_permission('integrations.view')) then raise exception 'PERMISSION_DENIED'; end if;
  return jsonb_build_object(
    'kinds', (select coalesce(jsonb_agg(to_jsonb(k) order by k.slot, k.label), '[]'::jsonb) from integration_kinds k),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'slot', i.slot, 'name', i.name, 'enabled', i.enabled, 'settings', i.settings,
                'secrets_set', coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(i.secrets) k), '[]'::jsonb), 'version', i.version,
                'last_test_at', i.last_test_at, 'last_test_ok', i.last_test_ok, 'last_test_message', i.last_test_message, 'updated_at', i.updated_at,
                'webhook_pending', (select count(*) from webhook_outbox w where w.integration_id = i.id and w.status in ('PENDING','SENDING')),
                'webhook_failed', (select count(*) from webhook_outbox w where w.integration_id = i.id and w.status = 'FAILED'),
                'webhook_last_sent_at', (select max(w.sent_at) from webhook_outbox w where w.integration_id = i.id and w.status = 'SENT')) order by i.slot, i.name), '[]'::jsonb) from integrations i));
end $$;

-- ------------------------------------------------------------------ outbound webhooks: an outbox like the email one
create table webhook_outbox (
  id              uuid primary key default gen_random_uuid(),
  integration_id  uuid not null references integrations(id) on delete cascade,
  event_type      text not null,
  payload         jsonb not null,
  status          text not null default 'PENDING' check (status in ('PENDING','SENDING','SENT','FAILED','SKIPPED')),
  attempts        int not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  leased_until    timestamptz,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '24 hours'),
  sent_at         timestamptz
);
create index webhook_outbox_due on webhook_outbox (next_attempt_at) where status in ('PENDING','SENDING');
create index webhook_outbox_integration on webhook_outbox (integration_id, created_at desc);
alter table webhook_outbox enable row level security;

-- Every audit-log row is offered to every enabled webhook whose "events" list matches it ("*", an exact name, or a prefix ending in *).
-- The payload carries WHAT happened and to what, never the old or new values and never the reason, so no personal data or setting leaves with it.
create or replace function enqueue_webhooks() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    insert into webhook_outbox (integration_id, event_type, payload)
    select i.id, new.action, jsonb_build_object('event', new.action, 'entity_type', new.entity_type, 'entity_id', new.entity_id, 'outcome', new.outcome,
                                                'actor_role', new.actor_role, 'occurred_at', new.occurred_at, 'correlation_id', new.correlation_id, 'delivery_of', 'audit_event')
      from integrations i
     where i.slot = 'WEBHOOK' and i.enabled
       and exists (select 1 from jsonb_array_elements_text(coalesce(i.settings->'events', '["*"]'::jsonb)) p
                    where p = '*' or p = new.action or (right(p, 1) = '*' and new.action like left(p, length(p) - 1) || '%'));
  exception when others then
    raise warning 'webhook enqueue failed: %', sqlerrm;                 -- an outbox problem must never stop an audit entry from being written
  end;
  return null;
end $$;
create trigger audit_logs_enqueue_webhooks after insert on audit_logs for each row execute function enqueue_webhooks();

create or replace function claim_webhook_batch(p_limit int default 25) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  update webhook_outbox set status = 'SKIPPED', last_error = 'expired before it could be sent', leased_until = null where status in ('PENDING','SENDING') and expires_at <= now();
  update webhook_outbox o set status = 'SKIPPED', last_error = 'the integration is switched off or was removed', leased_until = null
    where o.status in ('PENDING','SENDING') and not exists (select 1 from integrations i where i.id = o.integration_id and i.enabled);
  with due as (
    select id from webhook_outbox
     where (status = 'PENDING' and next_attempt_at <= now()) or (status = 'SENDING' and leased_until < now())
     order by created_at limit greatest(1, least(coalesce(p_limit, 25), 100)) for update skip locked
  ), upd as (
    update webhook_outbox o set status = 'SENDING', attempts = o.attempts + 1, leased_until = now() + interval '2 minutes'
      from due where o.id = due.id returning o.id, o.integration_id, o.event_type, o.payload, o.attempts, o.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', upd.id, 'integration_id', upd.integration_id, 'event_type', upd.event_type, 'payload', upd.payload, 'attempts', upd.attempts,
           'created_at', upd.created_at, 'url', i.settings->>'url', 'format', coalesce(i.settings->>'format', 'JSON'), 'name', i.name, 'signing_secret', i.secrets->>'signingSecret')), '[]'::jsonb)
    into v from upd join integrations i on i.id = upd.integration_id;
  return v;
end $$;

create or replace function mark_webhook_result(p_id uuid, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare o webhook_outbox;
begin
  select * into o from webhook_outbox where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status <> 'SENDING' then return; end if;
  if p_ok then update webhook_outbox set status = 'SENT', sent_at = now(), leased_until = null, last_error = null where id = p_id;
  elsif o.attempts >= 5 then update webhook_outbox set status = 'FAILED', leased_until = null, last_error = left(coalesce(p_error, 'unknown error'), 500) where id = p_id;
  else update webhook_outbox set status = 'PENDING', leased_until = null, last_error = left(coalesce(p_error, 'unknown error'), 500), next_attempt_at = now() + make_interval(mins => power(2, o.attempts)::int) where id = p_id;
  end if;
end $$;

-- ------------------------------------------------------------------ for the web tier only (named ops_, so they are never open to signed-in people)
create or replace function ops_integration_runtime(p_slot text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', i.id, 'kind', i.kind, 'name', i.name, 'version', i.version, 'settings', i.settings, 'secrets', i.secrets)
    from integrations i where i.slot = p_slot and i.enabled order by i.updated_at desc limit 1;
$$;
create or replace function ops_integration_get(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', i.id, 'kind', i.kind, 'slot', i.slot, 'name', i.name, 'enabled', i.enabled, 'version', i.version, 'settings', i.settings, 'secrets', i.secrets)
    from integrations i where i.id = p_id;
$$;
create or replace function ops_integration_record_test(p_actor uuid, p_id uuid, p_ok boolean, p_message text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare i integrations;
begin
  perform require_permission(p_actor, 'integrations.test');
  select * into i from integrations where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update integrations set last_test_at = app_now(), last_test_ok = p_ok, last_test_message = left(coalesce(p_message, ''), 300) where id = p_id;
  perform write_audit(p_actor, 'INTEGRATION_TESTED', 'integration', p_id::text, null, jsonb_build_object('kind', i.kind, 'name', i.name, 'ok', p_ok), null, null, case when p_ok then 'SUCCESS' else 'FAILURE' end);
end $$;
-- key rotation: the same secrets, encrypted under a new key. Not a configuration change (nothing about the integration changes), so it is audited but not approved.
create or replace function ops_integration_secrets_all() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'secrets', secrets)), '[]'::jsonb) from integrations where secrets <> '{}'::jsonb;
$$;
create or replace function ops_integration_rewrap(p_id uuid, p_secrets jsonb, p_operator text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform validate_integration_payload((select kind from integrations where id = p_id), (select settings from integrations where id = p_id), p_secrets, false);
  update integrations set secrets = p_secrets where id = p_id;
  perform write_audit(null, 'INTEGRATION_KEY_ROTATED', 'integration', p_id::text, null, jsonb_build_object('operator', left(coalesce(p_operator, 'unknown'), 100)));
end $$;

-- ------------------------------------------------------------------ retention and health know about the new outbox
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'purge_transient_data';
  v_new := replace(v_def, 'get diagnostics v_mail = row_count;',
    'get diagnostics v_mail = row_count; delete from webhook_outbox where created_at < app_now() - make_interval(days => s.email_days) and (status in (''SENT'',''FAILED'',''SKIPPED'') or expires_at < app_now());');
  if v_new = v_def then raise exception 'expected text not found in purge_transient_data'; end if;
  execute v_new;
end $$;

create or replace function ops_health() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'database', 'ok',
    'scheduler_last_run_at', (select last_run_at from job_heartbeats where job = 'scheduler'),
    'scheduler_age_seconds', (select extract(epoch from clock_timestamp() - last_run_at)::int from job_heartbeats where job = 'scheduler'),
    'email_pending', (select count(*) from email_outbox where status = 'PENDING'),
    'email_oldest_pending_minutes', (select extract(epoch from clock_timestamp() - min(created_at))::int / 60 from email_outbox where status = 'PENDING'),
    'email_failed', (select count(*) from email_outbox where status = 'FAILED'),
    'webhook_oldest_pending_minutes', (select extract(epoch from clock_timestamp() - min(created_at))::int / 60 from webhook_outbox where status in ('PENDING','SENDING')),
    'webhook_failed', (select count(*) from webhook_outbox where status = 'FAILED' and created_at > now() - interval '24 hours'),
    'job_failures_24h', (select count(*) from audit_logs where action = 'JOB_FAILED' and occurred_at > app_now() - interval '24 hours'),
    'clock_override_present', clock_override_present(),
    'schedule_version', (select max(version) from reporting_schedule_versions));
$$;

select lock_down_function_grants();
