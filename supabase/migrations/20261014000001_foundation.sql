-- 4CORE-OKR foundation: clock, audit, organisation, identity, RBAC.
-- Conventions: snake_case, uuid PKs, timestamptz, text + CHECK for controlled vocabularies.
-- All mutations are SECURITY DEFINER functions executable by service_role only (ADR-035).

create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------- clock (ADR-036)
create or replace function app_now() returns timestamptz
language plpgsql stable as $$
declare v text;
begin
  -- Test override is honoured only for direct superuser sessions, never via PostgREST.
  if session_user = 'postgres' then
    v := current_setting('app.test_now', true);
    if v is not null and v <> '' then
      return v::timestamptz;
    end if;
  end if;
  return now();
end $$;

-- ---------------------------------------------------------------- audit
create table audit_logs (
  id             uuid primary key default gen_random_uuid(),
  seq            bigint generated always as identity,   -- stable total order (several events can share one transaction timestamp)
  actor_user_id  uuid,
  actor_role     text,
  business_unit_id uuid,
  action         text not null,
  entity_type    text not null,
  entity_id      text,
  old_values     jsonb,
  new_values     jsonb,
  reason         text,
  outcome        text not null default 'SUCCESS' check (outcome in ('SUCCESS','DENIED','FAILURE')),
  correlation_id text,
  ip_address     text,
  user_agent     text,
  occurred_at    timestamptz not null default app_now()
);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx  on audit_logs (actor_user_id, occurred_at desc);
create index audit_logs_time_idx   on audit_logs (occurred_at desc, seq desc);

create or replace function forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'IMMUTABLE_RECORD' using detail = format('%s on %s is not permitted', tg_op, tg_table_name);
end $$;

create trigger audit_logs_immutable before update or delete on audit_logs
  for each row execute function forbid_mutation();
create trigger audit_logs_no_truncate before truncate on audit_logs
  for each statement execute function forbid_mutation();

-- ---------------------------------------------------------------- organisation
create table organisations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code          text not null unique,
  timezone      text not null default 'Africa/Lagos' check (timezone = 'Africa/Lagos'),
  currency_code char(3) not null default 'NGN' check (currency_code = 'NGN'),
  status        text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_at    timestamptz not null default app_now(),
  updated_at    timestamptz not null default app_now()
);
-- BR-ORG-001: exactly one organisation.
create unique index organisations_single_idx on organisations ((true));

create table business_units (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete restrict,
  code            text not null,
  name            text not null,
  status          text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  -- false for BUs that do not file weekly OKR reports (e.g. an admin/HQ unit): no report, no missing-report zero, not ranked
  reports_weekly  boolean not null default true,
  created_at      timestamptz not null default app_now(),
  updated_at      timestamptz not null default app_now(),
  unique (organisation_id, code)
);

create table employees (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete restrict,
  email            extensions.citext not null unique,
  first_name       text not null,
  last_name        text not null,
  business_unit_id uuid not null references business_units(id) on delete restrict,
  employment_status text not null default 'ACTIVE' check (employment_status in ('ACTIVE','INACTIVE')),
  created_at       timestamptz not null default app_now(),
  updated_at       timestamptz not null default app_now()
);
create index employees_bu_idx on employees (business_unit_id);

-- users.id = auth.users.id (ADR-035)
create table users (
  id              uuid primary key references auth.users(id) on delete restrict,
  employee_id     uuid not null unique references employees(id) on delete restrict,
  email           extensions.citext not null unique,
  status          text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED')),
  last_login_at   timestamptz,
  locked_until    timestamptz,
  failed_attempts int not null default 0,
  created_at      timestamptz not null default app_now(),
  updated_at      timestamptz not null default app_now()
);

create table roles (
  id   uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null
);
create table permissions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  description text not null
);
create table role_permissions (
  role_id       uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);
create table user_roles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  role_id          uuid not null references roles(id) on delete restrict,
  business_unit_id uuid references business_units(id) on delete restrict,
  granted_by       uuid references users(id),
  created_at       timestamptz not null default app_now(),
  unique (user_id, role_id)
);

insert into roles (code, name) values
  ('SUPER_ADMIN','Super Admin'),('ADMIN','Admin'),('BU_LEAD','BU Lead'),('PRESENTER','Presenter'),
  ('EXECUTIVE','Executive'),('DIRECTOR','Director'),('HR','HR'),('FINANCE','Finance');

insert into permissions (code, description) values
  ('strategy.annual_theme.view','View the annual theme'),
  ('strategy.annual_theme.create','Create the annual theme'),
  ('strategy.annual_theme.change_exception','Exceptionally change the annual theme'),
  ('strategy.quarter.manage','Create and activate quarters'),
  ('strategy.objective.create','Create quarterly objective'),
  ('strategy.objective.edit','Edit quarterly objective'),
  ('strategy.kr.create','Create key result'),
  ('strategy.kr.edit','Edit key result'),
  ('strategy.subkr.create','Create sub-KR'),
  ('strategy.subkr.edit','Edit sub-KR'),
  ('weekly_report.view_own_bu','View own BU weekly reports'),
  ('weekly_report.view_all','View all BU weekly reports'),
  ('weekly_report.create','Create weekly report'),
  ('weekly_report.edit','Edit weekly report'),
  ('weekly_report.submit','Submit weekly report'),
  ('weekly_report.review','Mark a final-locked report reviewed'),
  ('goal.create','Create goal'),('goal.edit','Edit goal'),('goal.delete','Delete goal'),
  ('task.create','Create task'),('task.edit','Edit task'),('task.delete','Delete task'),
  ('task.execute','Execute task status'),
  ('presentation.view','Use presentation mode'),
  ('integrity_correction.create','Perform integrity correction'),
  ('integrity_penalty.configure','Configure integrity penalty rate'),
  ('integrity_penalty.waive','Waive integrity penalty'),
  ('reporting.week.manage','Manage reporting weeks'),
  ('reporting.period.holiday.manage','Declare organisation holiday'),
  ('quarter.score.amend','Authorise late-report quarterly score amendment'),
  ('dashboard.executive.view','View executive dashboard'),
  ('attendance.session.manage','Manage attendance sessions / Skip OKR'),
  ('attendance.record','Record attendance'),
  ('attendance.amendment.request','Request attendance amendment'),
  ('attendance.amendment.approve','Approve/reject attendance amendment'),
  ('attendance.amendment.view','View attendance amendments'),
  ('attendance.session.outcome.correct','Correct a session outcome'),
  ('quote.record','Record weekly quote'),
  ('violation.create','Create violation'),('violation.edit','Edit violation'),
  ('violation.payment.record','Record violation payment'),
  ('finance.fund.view','View violation fund'),('finance.ledger.view','View ledger'),
  ('disbursement.create','Create disbursement request'),
  ('disbursement.approve','Approve disbursement'),('disbursement.reject','Reject disbursement'),
  ('disbursement.disburse','Record actual disbursement'),
  ('users.manage','Manage users'),('roles.manage','Manage roles'),
  ('business_units.manage','Manage business units'),('audit.read','Read audit log');

-- Role → permission matrix (ADR-035 notes; derived from 06-ROLES-PERMISSIONS scope rules).
create temporary table _rp (role_code text, perm text) on commit drop;
insert into _rp
select r, p from (values
  -- every role may view the annual theme
  ('SUPER_ADMIN','strategy.annual_theme.view'),('ADMIN','strategy.annual_theme.view'),('BU_LEAD','strategy.annual_theme.view'),
  ('PRESENTER','strategy.annual_theme.view'),('EXECUTIVE','strategy.annual_theme.view'),('DIRECTOR','strategy.annual_theme.view'),
  ('HR','strategy.annual_theme.view'),('FINANCE','strategy.annual_theme.view'),
  -- strategy administration
  ('SUPER_ADMIN','strategy.annual_theme.create'),('SUPER_ADMIN','strategy.annual_theme.change_exception'),
  ('ADMIN','strategy.annual_theme.create'),
  ('SUPER_ADMIN','strategy.quarter.manage'),('ADMIN','strategy.quarter.manage'),
  ('SUPER_ADMIN','strategy.objective.create'),('ADMIN','strategy.objective.create'),
  ('SUPER_ADMIN','strategy.objective.edit'),('ADMIN','strategy.objective.edit'),
  ('SUPER_ADMIN','strategy.kr.create'),('ADMIN','strategy.kr.create'),
  ('SUPER_ADMIN','strategy.kr.edit'),('ADMIN','strategy.kr.edit'),
  ('SUPER_ADMIN','strategy.subkr.create'),('ADMIN','strategy.subkr.create'),
  ('SUPER_ADMIN','strategy.subkr.edit'),('ADMIN','strategy.subkr.edit'),
  -- BU lead operates own BU report
  ('BU_LEAD','weekly_report.view_own_bu'),('BU_LEAD','weekly_report.create'),('BU_LEAD','weekly_report.edit'),
  ('BU_LEAD','weekly_report.submit'),('BU_LEAD','goal.create'),('BU_LEAD','goal.edit'),('BU_LEAD','goal.delete'),
  ('BU_LEAD','task.create'),('BU_LEAD','task.edit'),('BU_LEAD','task.delete'),('BU_LEAD','task.execute'),
  -- org-wide read
  ('SUPER_ADMIN','weekly_report.view_all'),('ADMIN','weekly_report.view_all'),('PRESENTER','weekly_report.view_all'),
  ('EXECUTIVE','weekly_report.view_all'),('DIRECTOR','weekly_report.view_all'),
  ('SUPER_ADMIN','dashboard.executive.view'),('ADMIN','dashboard.executive.view'),('PRESENTER','dashboard.executive.view'),
  ('EXECUTIVE','dashboard.executive.view'),('DIRECTOR','dashboard.executive.view'),
  -- presenter / integrity / review
  ('PRESENTER','presentation.view'),('ADMIN','presentation.view'),('SUPER_ADMIN','presentation.view'),
  ('PRESENTER','integrity_correction.create'),('ADMIN','integrity_correction.create'),('SUPER_ADMIN','integrity_correction.create'),
  ('PRESENTER','integrity_penalty.waive'),('ADMIN','integrity_penalty.waive'),('SUPER_ADMIN','integrity_penalty.waive'),
  ('ADMIN','integrity_penalty.configure'),('SUPER_ADMIN','integrity_penalty.configure'),
  ('PRESENTER','weekly_report.review'),('ADMIN','weekly_report.review'),('SUPER_ADMIN','weekly_report.review'),
  -- calendar / holiday / score amendment
  ('ADMIN','reporting.week.manage'),('SUPER_ADMIN','reporting.week.manage'),
  ('HR','reporting.period.holiday.manage'),('ADMIN','reporting.period.holiday.manage'),('SUPER_ADMIN','reporting.period.holiday.manage'),
  ('ADMIN','quarter.score.amend'),('SUPER_ADMIN','quarter.score.amend'),
  -- governance (milestone 2)
  ('HR','attendance.session.manage'),('ADMIN','attendance.session.manage'),('SUPER_ADMIN','attendance.session.manage'),
  ('HR','attendance.record'),('ADMIN','attendance.record'),
  ('HR','attendance.amendment.request'),
  ('ADMIN','attendance.amendment.approve'),('SUPER_ADMIN','attendance.amendment.approve'),
  ('HR','attendance.amendment.view'),('ADMIN','attendance.amendment.view'),('SUPER_ADMIN','attendance.amendment.view'),
  ('HR','quote.record'),('ADMIN','quote.record'),
  ('HR','violation.create'),('ADMIN','violation.create'),('HR','violation.edit'),('ADMIN','violation.edit'),
  ('HR','violation.payment.record'),('ADMIN','violation.payment.record'),
  -- finance
  ('HR','disbursement.create'),('ADMIN','disbursement.create'),
  ('FINANCE','disbursement.approve'),('FINANCE','disbursement.reject'),('FINANCE','disbursement.disburse'),
  ('FINANCE','finance.fund.view'),('FINANCE','finance.ledger.view'),
  ('HR','finance.fund.view'),('ADMIN','finance.fund.view'),('SUPER_ADMIN','finance.fund.view'),
  ('EXECUTIVE','finance.fund.view'),('DIRECTOR','finance.fund.view'),
  ('ADMIN','finance.ledger.view'),('SUPER_ADMIN','finance.ledger.view'),
  -- administration
  ('SUPER_ADMIN','users.manage'),('ADMIN','users.manage'),('SUPER_ADMIN','roles.manage'),
  ('SUPER_ADMIN','business_units.manage'),('ADMIN','business_units.manage'),
  ('SUPER_ADMIN','audit.read'),('ADMIN','audit.read')
) as t(r, p);

insert into role_permissions (role_id, permission_id)
select ro.id, pe.id from _rp join roles ro on ro.code = _rp.role_code join permissions pe on pe.code = _rp.perm;

-- ---------------------------------------------------------------- authorisation helpers
create or replace function actor_has_permission(p_actor uuid, p_code text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from users u
    join user_roles ur on ur.user_id = u.id
    join role_permissions rp on rp.role_id = ur.role_id
    join permissions p on p.id = rp.permission_id
    where u.id = p_actor and u.status = 'ACTIVE' and p.code = p_code);
$$;

create or replace function actor_bu(p_actor uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select e.business_unit_id from users u join employees e on e.id = u.employee_id where u.id = p_actor;
$$;

create or replace function actor_role_codes(p_actor uuid) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(r.code order by r.code), '{}') from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = p_actor;
$$;

create or replace function require_permission(p_actor uuid, p_code text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_actor is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not actor_has_permission(p_actor, p_code) then
    raise exception 'PERMISSION_DENIED' using detail = p_code;
  end if;
end $$;

-- RLS-facing wrappers (auth.uid() = caller's verified JWT subject)
create or replace function auth_has_permission(p_code text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select actor_has_permission(auth.uid(), p_code);
$$;
create or replace function auth_bu() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select actor_bu(auth.uid());
$$;

-- ---------------------------------------------------------------- audit writer
create or replace function write_audit(
  p_actor uuid, p_action text, p_entity_type text, p_entity_id text,
  p_old jsonb default null, p_new jsonb default null, p_reason text default null,
  p_bu uuid default null, p_outcome text default 'SUCCESS'
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := gen_random_uuid();
  v_headers json;
  v_role text;
begin
  begin v_headers := nullif(current_setting('request.headers', true), '')::json; exception when others then v_headers := null; end;
  if p_actor is not null then v_role := array_to_string(actor_role_codes(p_actor), ','); end if;
  insert into audit_logs (id, actor_user_id, actor_role, business_unit_id, action, entity_type, entity_id,
                          old_values, new_values, reason, outcome, correlation_id, ip_address, user_agent)
  values (v_id, p_actor, v_role, p_bu, p_action, p_entity_type, p_entity_id, p_old, p_new, p_reason, p_outcome,
          v_headers->>'x-correlation-id', v_headers->>'x-forwarded-for', v_headers->>'user-agent');
  return v_id;
end $$;

-- ---------------------------------------------------------------- notifications
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  event_type  text not null,
  entity_type text,
  entity_id   text,
  title       text not null,
  message     text not null,
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz not null default app_now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on notifications (user_id, created_at desc);

-- Idempotent fan-out. Failure to notify must never break the business transaction.
create or replace function notify_users(
  p_user_ids uuid[], p_event text, p_entity_type text, p_entity_id text,
  p_title text, p_message text, p_dedupe text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into notifications (user_id, event_type, entity_type, entity_id, title, message, dedupe_key)
  select u, p_event, p_entity_type, p_entity_id, p_title, p_message, p_dedupe from unnest(p_user_ids) u
  on conflict (user_id, dedupe_key) do nothing;
exception when others then
  raise warning 'notify_users failed: %', sqlerrm;
end $$;

create or replace function users_with_permission(p_code text) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct u.id), '{}') from users u
  join user_roles ur on ur.user_id = u.id join role_permissions rp on rp.role_id = ur.role_id
  join permissions p on p.id = rp.permission_id where u.status = 'ACTIVE' and p.code = p_code;
$$;

create or replace function users_with_role(p_role text) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct u.id), '{}') from users u
  join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id
  where u.status = 'ACTIVE' and r.code = p_role;
$$;

-- ---------------------------------------------------------------- grant lockdown (ADR-035)
-- Every function is service_role-only except the explicit read-side helpers that RLS policies invoke.
-- Each later migration ends with `select lock_down_function_grants();`.
create or replace function lock_down_function_grants() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.proname <> 'lock_down_function_grants' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    if r.proname in ('auth_has_permission','auth_bu','app_now','report_phase','quarter_is_locked','auth_can_view_bu') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;
revoke all on function lock_down_function_grants() from public, anon, authenticated;
grant execute on function lock_down_function_grants() to service_role;
select lock_down_function_grants();
