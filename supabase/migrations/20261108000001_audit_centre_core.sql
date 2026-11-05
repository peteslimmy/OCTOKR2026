-- Audit & Security Centre, part 1 of 2: event model, request context, redaction, hash chain, DB-level permissions (ADR-107..ADR-111).
--
-- Additive. The one audit table (`audit_logs`) and its one writer (`write_audit`, signature unchanged) are kept, so every existing caller,
-- the webhook trigger and the existing tests keep working. What changes:
--  1. audit_logs gains the fields of the enterprise event model (category, severity, channel, request/session/workflow ids, actor snapshot,
--     parsed device, metadata) and the outcome list is widened (REJECTED, PARTIAL).
--  2. A BEFORE INSERT trigger fills those fields for EVERY insert from one place: actor snapshot, request context passed by the app server
--     (trusted client IP, user agent, session reference, request id), category/severity from `audit_action_rules`, secret redaction.
--  3. A second BEFORE INSERT trigger links each new row to the previous one with a SHA-256 hash chain (tamper evidence).
--     Rows written before this migration stay unchained and unchanged ("history is not rewritten"); `audit_chain_meta` records the genesis.
--  4. UPDATE, DELETE, TRUNCATE and direct INSERT are revoked from every application role (the immutability trigger stays as a second layer).
-- `security_logs` and `system_logs` are views over audit_logs (same identifiers, no duplicated data).

-- ------------------------------------------------------------------ permissions
insert into permissions (code, description, protected, reserved, module, risk) values
  ('audit.alerts.manage',    'Review security alerts: set an investigation status and note',                         false, false, 'Audit & security', 'high'),
  ('audit.rules.configure',  'Change the thresholds, severity and on/off state of the security detection rules',     true,  false, 'Audit & security', 'critical')
on conflict (code) do nothing;
insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values ('SUPER_ADMIN','audit.alerts.manage'), ('ADMIN','audit.alerts.manage'), ('SUPER_ADMIN','audit.rules.configure')) v(role_code, perm)
join roles r on r.code = v.role_code join permissions p on p.code = v.perm
on conflict do nothing;

-- ------------------------------------------------------------------ the event model
alter table audit_logs
  add column if not exists event_category    text,
  add column if not exists severity          text,
  add column if not exists channel           text,
  add column if not exists request_id        text,
  add column if not exists workflow_id       text,
  add column if not exists related_approval_id text,
  add column if not exists session_ref       text,
  add column if not exists actor_name        text,
  add column if not exists actor_email       text,
  add column if not exists actor_bu_id       uuid,
  add column if not exists actor_bu_name     text,
  add column if not exists actor_scope       text,
  add column if not exists ip_trusted        boolean,
  add column if not exists browser           text,
  add column if not exists os                text,
  add column if not exists device            text,
  add column if not exists metadata          jsonb,
  add column if not exists chain_seq         bigint,
  add column if not exists prev_hash         text,
  add column if not exists row_hash          text;

alter table audit_logs drop constraint if exists audit_logs_outcome_check;
alter table audit_logs add constraint audit_logs_outcome_check check (outcome in ('SUCCESS','FAILURE','DENIED','REJECTED','PARTIAL'));
alter table audit_logs add constraint audit_logs_severity_check check (severity is null or severity in ('INFO','LOW','MEDIUM','HIGH','CRITICAL'));
alter table audit_logs add constraint audit_logs_channel_check  check (channel  is null or channel  in ('WEB','API','SYSTEM','BACKGROUND_JOB'));
create unique index if not exists audit_logs_chain_idx on audit_logs (chain_seq) where chain_seq is not null;
create index if not exists audit_logs_category_idx on audit_logs (event_category, occurred_at desc);
create index if not exists audit_logs_request_idx  on audit_logs (request_id) where request_id is not null;
create index if not exists audit_logs_session_idx  on audit_logs (session_ref, occurred_at) where session_ref is not null;
create index if not exists audit_logs_workflow_idx on audit_logs (workflow_id) where workflow_id is not null;
create index if not exists audit_logs_action_idx   on audit_logs (action, occurred_at desc);

-- ------------------------------------------------------------------ classification: which category and default severity an action has
create table audit_action_rules (
  id        serial primary key,
  pattern   text not null unique,                         -- SQL LIKE pattern on the action code
  category  text not null,
  severity  text not null check (severity in ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  priority  int  not null default 100                      -- the highest priority that matches wins
);
insert into audit_action_rules (pattern, category, severity, priority) values
  ('AUTH_LOGIN_FAILED',        'AUTHENTICATION',    'MEDIUM',   900), ('AUTH_ACCOUNT_LOCKED',     'AUTHENTICATION', 'HIGH',     900),
  ('AUTH_MFA_RESET%',          'SECURITY',          'HIGH',     900), ('AUTH_BREAK_GLASS%',       'SECURITY',       'CRITICAL', 900),
  ('AUTH_SESSIONS%',           'SECURITY',          'MEDIUM',   900), ('AUTH_RECOVERY%',           'SECURITY',          'HIGH',     900), ('AUTH_PASSWORD%',          'AUTHENTICATION', 'LOW',      800),
  ('AUTH\_%',                  'AUTHENTICATION',    'INFO',     100),
  ('ACCESS_DENIED',            'SECURITY',          'MEDIUM',   900), ('SECURITY\_%',             'SECURITY',       'MEDIUM',   800),
  ('AUDIT_CHAIN_BROKEN',       'SECURITY',          'CRITICAL', 950), ('AUDIT_EXPORTED',          'FILES_EXPORT',   'MEDIUM',   900),
  ('AUDIT\_%',                 'SECURITY',          'LOW',      100),
  ('USER_ROLES_CHANGED',       'ROLES_PERMISSIONS', 'HIGH',     900), ('ROLE\_%',                 'ROLES_PERMISSIONS','HIGH',   800),
  ('PERMISSION\_%',            'ROLES_PERMISSIONS', 'HIGH',     800), ('USER_UNIT_SCOPE%',        'ROLES_PERMISSIONS','HIGH',   800),
  ('ACCESS_REVIEW%',           'ROLES_PERMISSIONS', 'LOW',      700),
  ('USER_DELETED',             'USER_LIFECYCLE',    'HIGH',     900), ('USER\_%',                 'USER_LIFECYCLE', 'MEDIUM',   100),
  ('EMPLOYEE_LIFECYCLE%',      'USER_LIFECYCLE',    'MEDIUM',   800), ('EMPLOYEE_IMPORT%',        'FILES_EXPORT',   'MEDIUM',   800),
  ('EMPLOYEE\_%',              'USER_LIFECYCLE',    'LOW',      100), ('BU\_%',                   'ORGANISATION',   'LOW',      100),
  ('BUSINESS_UNIT%',           'FILES_EXPORT',      'MEDIUM',   800), ('ORGANISATION\_%',         'SYSTEM',         'INFO',     100),
  ('CONFIG_CHANGE_EMERGENCY',  'CONFIGURATION',     'HIGH',     900), ('CONFIG_CHANGE\_%',        'CONFIGURATION',  'MEDIUM',   800),
  ('BRANDING\_%',              'CONFIGURATION',     'MEDIUM',   800), ('SITE\_%',                 'CONFIGURATION',  'LOW',      800),
  ('EMAIL_DOMAIN%',            'CONFIGURATION',     'MEDIUM',   800), ('RETENTION\_%',            'CONFIGURATION',  'HIGH',     800),
  ('INTEGRATION_KEY%',         'CONFIGURATION',     'HIGH',     900), ('INTEGRATION\_%',          'CONFIGURATION',  'MEDIUM',   800),
  ('NOTIFICATION\_%',          'CONFIGURATION',     'LOW',      800), ('PENALTY_RATE%',           'CONFIGURATION',  'MEDIUM',   900),
  ('LOCK_SCHEDULE%',           'SCHEDULING',        'MEDIUM',   800), ('REPORTING_WEEK_%LOCK%',   'SCHEDULING',     'MEDIUM',   800),
  ('REPORTING_SCHEDULE%',      'SCHEDULING',        'MEDIUM',   800), ('REPORTING_WEEK\_%',       'SCHEDULING',     'LOW',      700),
  ('QUARTER%',                 'SCHEDULING',        'LOW',      700), ('HOLIDAY%',                'SCHEDULING',     'MEDIUM',   800),
  ('ORGANIZATION_HOLIDAY%',    'SCHEDULING',        'MEDIUM',   800),
  ('STRATEGY_CHANGE\_%',       'STRATEGY',          'MEDIUM',   800), ('STRATEGY\_%',             'STRATEGY',       'LOW',      700),
  ('OBJECTIVE\_%',             'STRATEGY',          'LOW',      700), ('KR\_%',                   'STRATEGY',       'LOW',      700),
  ('SUBKR\_%',                 'STRATEGY',          'LOW',      700), ('GOAL%',                   'STRATEGY',       'LOW',      700),
  ('ANNUAL_THEME%',            'STRATEGY',          'LOW',      700), ('TASK\_%',                 'REPORTING',      'INFO',     700),
  ('REPORT_EXPORTED',          'FILES_EXPORT',      'MEDIUM',   900), ('REPORT\_%',               'REPORTING',      'LOW',      700),
  ('WEEKLY\_%',                'REPORTING',         'LOW',      700), ('SKIPPED\_%',              'REPORTING',      'LOW',      700),
  ('QUOTE\_%',                 'REPORTING',         'INFO',     700), ('WEEKLY_QUOTE%',           'REPORTING',      'INFO',     700),
  ('INTEGRITY\_%',             'INTEGRITY',         'HIGH',     800), ('SESSION_CORRECTION%',     'INTEGRITY',      'HIGH',     800),
  ('QUARTER_SCORE_AMENDED',    'INTEGRITY',         'HIGH',     900), ('LATE_REPORT%',            'INTEGRITY',      'MEDIUM',   800),
  ('ATTENDANCE\_%',            'ATTENDANCE_HR',     'LOW',      700), ('OKR_SESSION_SKIPPED',     'ATTENDANCE_HR',  'MEDIUM',   900),
  ('GOVERNANCE\_%',            'GOVERNANCE',        'LOW',      700), ('VIOLATION\_%',            'ATTENDANCE_HR',  'MEDIUM',   700),
  ('LEDGER\_%',                'FINANCE',           'HIGH',     800), ('DISBURSEMENT\_%',         'FINANCE',        'MEDIUM',   800),
  ('PENALTY\_%',               'FINANCE',           'MEDIUM',   700), ('PAYMENT\_%',              'FINANCE',        'MEDIUM',   700),
  ('EVIDENCE\_%',              'FILES_EXPORT',      'LOW',      800), ('FILE\_%',                 'FILES_EXPORT',   'LOW',      800),
  ('%EXPORT%',                 'FILES_EXPORT',      'MEDIUM',   600), ('%IMPORT%',                'FILES_EXPORT',   'MEDIUM',   600),
  ('OKR_SESSION\_%',           'GOVERNANCE',        'INFO',     600), ('EXEC_OVERSIGHT\_%',       'GOVERNANCE',     'LOW',      600),
  ('JOB_FAILED',               'SYSTEM',            'HIGH',     900), ('JOB\_%',                  'SYSTEM',         'INFO',     800),
  ('TRANSIENT_DATA_PURGED',    'SYSTEM',            'LOW',      800), ('AI\_%',                   'SYSTEM',         'INFO',     100),
  ('INSIGHT\_%',               'REPORTING',         'INFO',     600);
alter table audit_action_rules enable row level security;       -- no policy: only the service role and the trigger read it
grant select on audit_action_rules to service_role;

-- ------------------------------------------------------------------ helpers
-- Secret redaction: any key that names a secret has its value replaced, at any depth, in everything the log stores.
create or replace function audit_redact(j jsonb) returns jsonb
language plpgsql immutable as $$
declare k text; v jsonb; out jsonb;
begin
  if j is null then return null; end if;
  if jsonb_typeof(j) = 'object' then
    out := '{}'::jsonb;
    for k, v in select * from jsonb_each(j) loop
      if k !~* '(_set|_names?|_keys|_count|_by|_at|_required|_enabled|_changed|_present)$' and k ~* '(pass(word|phrase)?|secret|token|api_?key|otp|totp|recovery_?code|authori[sz]ation|cookie|service_?role|private_?key|credential|signing_?key|cipher|encrypted|mfa_?code|pin_?code)' and jsonb_typeof(v) <> 'null' then
        out := out || jsonb_build_object(k, '[REDACTED]');
      else
        out := out || jsonb_build_object(k, audit_redact(v));
      end if;
    end loop;
    return out;
  elsif jsonb_typeof(j) = 'array' then
    return coalesce((select jsonb_agg(audit_redact(e)) from jsonb_array_elements(j) e), '[]'::jsonb);
  end if;
  return j;
end $$;

-- Browser, operating system and device class from a user-agent string (best effort; the raw string is kept as well).
create or replace function audit_parse_ua(ua text) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'browser', case when ua is null or ua = '' then null
                    when ua ~* 'edg(e|a|ios)?/' then 'Edge' when ua ~* 'opr/|opera' then 'Opera' when ua ~* 'firefox|fxios' then 'Firefox'
                    when ua ~* 'chrome|crios' then 'Chrome' when ua ~* 'safari' then 'Safari' when ua ~* 'curl|wget|node|undici|python|axios|postman|okhttp|go-http' then 'Script/Client' else 'Other' end,
    'os',      case when ua is null or ua = '' then null
                    when ua ~* 'windows' then 'Windows' when ua ~* 'android' then 'Android' when ua ~* 'iphone|ipad|ios' then 'iOS'
                    when ua ~* 'mac os|macintosh' then 'macOS' when ua ~* 'linux|x11' then 'Linux' else 'Other' end,
    'device',  case when ua is null or ua = '' then null
                    when ua ~* 'ipad|tablet' then 'Tablet' when ua ~* 'mobi|iphone|android' then 'Mobile'
                    when ua ~* 'curl|wget|node|undici|python|axios|postman|okhttp|go-http' then 'Automated' else 'Desktop' end);
$$;

create or replace function audit_sev_rank(s text) returns int language sql immutable as $$
  select case s when 'CRITICAL' then 5 when 'HIGH' then 4 when 'MEDIUM' then 3 when 'LOW' then 2 when 'INFO' then 1 else 0 end;
$$;

-- The hash of one row, over every field that carries meaning, chained to the hash before it.
create or replace function audit_row_hash(r audit_logs) returns text
language sql immutable as $$
  select encode(sha256(convert_to(concat_ws('|',
    r.id::text, coalesce(r.chain_seq::text, ''), coalesce(r.prev_hash, ''),
    to_char(r.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    coalesce(r.actor_user_id::text, ''), coalesce(r.actor_role, ''), r.action, r.entity_type, coalesce(r.entity_id, ''),
    coalesce(r.old_values::text, ''), coalesce(r.new_values::text, ''), coalesce(r.reason, ''), r.outcome,
    coalesce(r.ip_address, ''), coalesce(r.user_agent, ''), coalesce(r.request_id, ''), coalesce(r.session_ref, ''), coalesce(r.correlation_id, ''),
    coalesce(r.event_category, ''), coalesce(r.severity, ''), coalesce(r.channel, ''), coalesce(r.workflow_id, ''), coalesce(r.metadata::text, '')), 'UTF8')), 'hex');
$$;

-- ------------------------------------------------------------------ trigger 1: complete every row from one place
create or replace function audit_logs_enrich() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare h json; v_ua jsonb; u record; v_rule record; v_roles text[];
begin
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then h := null; end;

  -- request context. The app server passes these on its own calls; a header from a browser never reaches this far (the service key is required).
  if h->>'x-audit-ip' is not null then new.ip_address := left(h->>'x-audit-ip', 64); new.ip_trusted := true;
  else new.ip_trusted := false; end if;
  if h->>'x-audit-ua' is not null then new.user_agent := left(h->>'x-audit-ua', 400); end if;
  new.user_agent := left(new.user_agent, 400);
  new.request_id  := coalesce(new.request_id, left(h->>'x-request-id', 80), new.correlation_id);
  new.session_ref := coalesce(new.session_ref, left(h->>'x-audit-session', 64));
  new.channel     := coalesce(new.channel, nullif(h->>'x-audit-channel', ''), case when h is null then 'SYSTEM' else 'WEB' end);
  if new.channel not in ('WEB','API','SYSTEM','BACKGROUND_JOB') then new.channel := 'WEB'; end if;
  v_ua := audit_parse_ua(new.user_agent);
  new.browser := coalesce(new.browser, v_ua->>'browser');
  new.os      := coalesce(new.os, v_ua->>'os');
  new.device  := coalesce(new.device, v_ua->>'device');

  -- actor as they were at the time of the event (a later rename, transfer or deletion does not rewrite history)
  if new.actor_user_id is not null then
    select e.first_name || ' ' || e.last_name as nm, coalesce(e.email::text, u2.email::text) as em, e.business_unit_id as bu, b.name as bn
      into u from users u2 left join employees e on e.id = u2.employee_id left join business_units b on b.id = e.business_unit_id where u2.id = new.actor_user_id;
    if found then
      new.actor_name := coalesce(new.actor_name, u.nm); new.actor_email := coalesce(new.actor_email, u.em);
      new.actor_bu_id := coalesce(new.actor_bu_id, u.bu); new.actor_bu_name := coalesce(new.actor_bu_name, u.bn);
    end if;
    v_roles := string_to_array(coalesce(new.actor_role, ''), ',');
    if new.actor_scope is null then
      new.actor_scope := case when v_roles && array['SUPER_ADMIN','ADMIN','EXECUTIVE','DIRECTOR','HR','FINANCE'] then 'ORGANISATION' else 'BUSINESS_UNIT' end;
    end if;
  elsif new.actor_scope is null then
    new.actor_scope := 'SYSTEM';
  end if;

  -- category and severity from the action; a refusal or failure is never below MEDIUM
  select category, severity into v_rule from audit_action_rules where new.action like pattern order by priority desc, length(pattern) desc limit 1;
  new.event_category := coalesce(new.event_category, v_rule.category, 'OTHER');
  new.severity := coalesce(new.severity, v_rule.severity, 'INFO');
  if new.outcome in ('DENIED','FAILURE') and audit_sev_rank(new.severity) < 3 then new.severity := 'MEDIUM'; end if;
  if new.event_category = 'SYSTEM' and new.channel = 'SYSTEM' and new.actor_user_id is null then new.channel := 'BACKGROUND_JOB'; end if;

  -- workflow: the several steps of one request/approve/apply chain share the request record's id
  new.workflow_id := coalesce(new.workflow_id, nullif(current_setting('app.audit_workflow', true), ''),
    case when new.entity_type ~ '(_request|_correction)$' then new.entity_id end);
  new.related_approval_id := coalesce(new.related_approval_id, nullif(current_setting('app.audit_approval', true), ''),
    case when new.workflow_id is not null and new.action ~ '(APPLIED|EXECUTED|APPROVED)$' then new.workflow_id end);

  -- secrets never reach the log
  new.old_values := audit_redact(new.old_values);
  new.new_values := audit_redact(new.new_values);
  new.metadata   := audit_redact(new.metadata);
  return new;
end $$;

-- ------------------------------------------------------------------ trigger 2: the hash chain
create table audit_chain_meta (
  id               boolean primary key default true check (id),
  genesis_at       timestamptz not null default now(),
  legacy_rows      bigint not null,                -- rows written before the chain started: kept exactly as they were, not chained
  legacy_max_seq   bigint,
  note             text not null
);
insert into audit_chain_meta (legacy_rows, legacy_max_seq, note)
select count(*), max(seq), 'The chain starts with the first row written after this migration. Earlier rows are protected by the immutability trigger only.' from audit_logs;
alter table audit_chain_meta enable row level security;
grant select on audit_chain_meta to service_role;

create or replace function audit_logs_chain() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare p record;
begin
  perform pg_advisory_xact_lock(hashtext('audit_logs_chain'));        -- one writer at a time: the order of the chain is the order of the locks
  select chain_seq, row_hash into p from audit_logs where chain_seq is not null order by chain_seq desc limit 1;
  new.chain_seq := coalesce(p.chain_seq, 0) + 1;
  new.prev_hash := coalesce(p.row_hash, 'GENESIS');
  new.row_hash := audit_row_hash(new);
  return new;
end $$;

create trigger audit_logs_1_enrich before insert on audit_logs for each row execute function audit_logs_enrich();
create trigger audit_logs_2_chain  before insert on audit_logs for each row execute function audit_logs_chain();

-- Recomputes the chain from the first chained row (or `p_from`) and reports the first row that does not match.
create or replace function audit_verify_chain(p_from bigint default 1) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare b record; n bigint; v_last bigint;
begin
  select count(*), max(chain_seq) into n, v_last from audit_logs where chain_seq >= p_from;
  select x.chain_seq, x.seq, x.id, x.problem into b from (
    select a.chain_seq, a.seq, a.id,
           case when a.row_hash is distinct from audit_row_hash(a) then 'CONTENT_CHANGED'
                when a.prev_hash is distinct from coalesce(lag(a.row_hash) over w, 'GENESIS') then 'LINK_BROKEN'
                when lag(a.chain_seq) over w is not null and a.chain_seq <> lag(a.chain_seq) over w + 1 then 'ROW_MISSING' end as problem
    from audit_logs a where a.chain_seq >= greatest(p_from - 1, 1) window w as (order by a.chain_seq)) x
  where x.problem is not null and x.chain_seq >= p_from order by x.chain_seq limit 1;
  if found then
    return jsonb_build_object('ok', false, 'checked', n, 'broken_chain_seq', b.chain_seq, 'broken_seq', b.seq, 'broken_event_id', b.id, 'problem', b.problem);
  end if;
  return jsonb_build_object('ok', true, 'checked', n, 'last_chain_seq', v_last);
end $$;

-- A verification that is itself recorded; a failure is written as a CRITICAL event.
create or replace function audit_verify_and_record(p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if p_actor is not null then perform require_permission(p_actor, 'audit.read'); end if;
  v := audit_verify_chain(1);
  if (v->>'ok')::boolean then
    perform write_audit(p_actor, 'AUDIT_CHAIN_VERIFIED', 'audit_log', 'chain', null, v);
  else
    perform write_audit(p_actor, 'AUDIT_CHAIN_BROKEN', 'audit_log', 'chain', null, v, null, null, 'FAILURE');
  end if;
  return v;
end $$;

-- ------------------------------------------------------------------ DB-level permissions: nothing in the application can change or remove an audit row
revoke insert, update, delete, truncate on audit_logs from public, anon, authenticated, service_role;
grant select on audit_logs to service_role;

-- ------------------------------------------------------------------ logs by layer: views over the one table (same ids, no duplicated data)
create or replace view security_logs with (security_invoker = true) as
  select * from audit_logs where event_category in ('AUTHENTICATION','SECURITY','ROLES_PERMISSIONS') or outcome in ('DENIED','FAILURE','REJECTED');
create or replace view system_logs with (security_invoker = true) as
  select * from audit_logs where event_category = 'SYSTEM' or channel in ('SYSTEM','BACKGROUND_JOB');
grant select on security_logs, system_logs to authenticated, service_role;

-- ------------------------------------------------------------------ events the application records that no business function does
-- A refusal before a person is known, a failed second factor, a rejected cross-site request, a file download. Repeats are collapsed per person/address/route.
create or replace function record_security_event(p_actor uuid, p_action text, p_outcome text, p_entity_type text, p_entity_id text, p_meta jsonb default null, p_collapse_seconds int default 60) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare h json; v_ip text;
begin
  if p_action not in ('SECURITY_AUTH_REQUIRED','SECURITY_MFA_REQUIRED','SECURITY_STEP_UP_REQUIRED','SECURITY_CROSS_SITE_REJECTED','SECURITY_MFA_CODE_FAILED','SECURITY_RATE_LIMITED','FILE_DOWNLOADED','FILE_VIEWED','SECURITY_PASSWORD_CHANGE_REQUIRED') then
    raise exception 'VALIDATION_ERROR' using detail = 'unknown security event';
  end if;
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then h := null; end;
  v_ip := h->>'x-audit-ip';
  if p_collapse_seconds > 0 and exists (select 1 from audit_logs where action = p_action and entity_id is not distinct from left(p_entity_id, 200)
        and actor_user_id is not distinct from p_actor and ip_address is not distinct from v_ip and occurred_at > app_now() - make_interval(secs => p_collapse_seconds)) then
    return false;
  end if;
  perform write_audit(p_actor, p_action, coalesce(nullif(p_entity_type, ''), 'route'), left(p_entity_id, 200), null, p_meta, null, null, coalesce(p_outcome, 'DENIED'));
  return true;
end $$;

-- Looking at the audit log is itself recorded (one view event per person per minute).
create or replace function record_audit_access(p_actor uuid, p_kind text, p_detail jsonb default null, p_rows int default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_permission(p_actor, 'audit.read');
  if p_kind = 'VIEWED' then
    if exists (select 1 from audit_logs where action = 'AUDIT_VIEWED' and actor_user_id = p_actor and occurred_at > app_now() - interval '1 minute') then return false; end if;
    perform write_audit(p_actor, 'AUDIT_VIEWED', 'audit_log', 'view', null, jsonb_build_object('filter', coalesce(p_detail, '{}'::jsonb), 'rows', p_rows));
  elsif p_kind in ('CSV','PDF') then
    perform write_audit(p_actor, 'AUDIT_EXPORTED', 'audit_log', 'export', null, jsonb_build_object('format', p_kind, 'filter', coalesce(p_detail, '{}'::jsonb), 'rows', p_rows));
  else
    raise exception 'VALIDATION_ERROR' using detail = 'unknown access kind';
  end if;
  return true;
end $$;

-- ------------------------------------------------------------------ lifecycle changes made by the system (no person) reach the audit log too
create or replace function lc_event_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.source = 'SYSTEM' then
    perform write_audit(null, 'EMPLOYEE_LIFECYCLE_SYSTEM_CHANGE', 'employee', new.employee_id::text, null,
      jsonb_build_object('event_type', new.event_type, 'from_bu', new.from_bu_name, 'to_bu', new.to_bu_name, 'role', new.role_code, 'effective_date', new.effective_date), new.reason, coalesce(new.to_bu_id, new.from_bu_id));
  end if;
  return new;
end $$;
do $$ begin
  if to_regclass('employee_lifecycle_events') is not null and not exists (select 1 from pg_trigger where tgname = 'employee_lifecycle_events_audit') then
    create trigger employee_lifecycle_events_audit after insert on employee_lifecycle_events for each row execute function lc_event_audit();
  end if;
end $$;

select lock_down_function_grants();
