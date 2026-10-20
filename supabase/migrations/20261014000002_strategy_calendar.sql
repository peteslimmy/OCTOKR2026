-- Strategy hierarchy (organisation-wide) and reporting calendar.

-- ---------------------------------------------------------------- strategy tables
create table annual_themes (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete restrict,
  year            int  not null check (year between 2000 and 2200),
  theme           text not null check (btrim(theme) <> ''),
  created_by      uuid references users(id),
  created_at      timestamptz not null default app_now(),
  updated_at      timestamptz not null default app_now(),
  unique (organisation_id, year)
);

create table annual_theme_changes (
  id              uuid primary key default gen_random_uuid(),
  annual_theme_id uuid not null references annual_themes(id) on delete restrict,
  old_theme       text not null,
  new_theme       text not null,
  reason          text not null check (btrim(reason) <> ''),
  changed_by      uuid not null references users(id),
  changed_at      timestamptz not null default app_now()
);
create trigger annual_theme_changes_immutable before update or delete on annual_theme_changes
  for each row execute function forbid_mutation();

create table quarters (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete restrict,
  year            int  not null,
  quarter_number  int  not null check (quarter_number between 1 and 4),
  starts_on       date not null,
  ends_on         date not null,
  status          text not null default 'PLANNED' check (status in ('PLANNED','ACTIVE','LOCKED')),
  activated_at    timestamptz,
  locked_at       timestamptz,
  created_at      timestamptz not null default app_now(),
  unique (organisation_id, year, quarter_number),
  check (ends_on > starts_on)
);

create table quarterly_objectives (
  id          uuid primary key default gen_random_uuid(),
  quarter_id  uuid not null unique references quarters(id) on delete restrict,
  title       text not null check (btrim(title) <> ''),
  description text,
  created_by  uuid references users(id),
  created_at  timestamptz not null default app_now(),
  updated_at  timestamptz not null default app_now()
);

create table key_results (
  id          uuid primary key default gen_random_uuid(),
  objective_id uuid not null references quarterly_objectives(id) on delete restrict,
  sequence    int  not null check (sequence between 1 and 4),
  code        text not null,
  title       text not null check (btrim(title) <> ''),
  description text,
  created_at  timestamptz not null default app_now(),
  updated_at  timestamptz not null default app_now(),
  unique (objective_id, sequence),
  unique (objective_id, code)
);

create table sub_key_results (
  id            uuid primary key default gen_random_uuid(),
  key_result_id uuid not null references key_results(id) on delete restrict,
  sequence      int  not null check (sequence >= 1),
  code          text not null,
  title         text not null check (btrim(title) <> ''),
  description   text,
  created_at    timestamptz not null default app_now(),
  updated_at    timestamptz not null default app_now(),
  unique (key_result_id, sequence),
  unique (key_result_id, code)
);
create index sub_key_results_kr_idx on sub_key_results (key_result_id);

-- A quarter is locked from the moment the next quarter begins, whether or not the job has run.
create or replace function quarter_is_locked(p_quarter_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select q.status = 'LOCKED'
                      or app_now() >= ((q.ends_on + 1)::timestamp at time zone 'Africa/Lagos')
                   from quarters q where q.id = p_quarter_id), false);
$$;

-- Defence in depth: strategy rows are never deleted and never edited once the quarter is locked.
create or replace function guard_strategy_row() returns trigger
language plpgsql as $$
declare v_q uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE_RECORD' using detail = 'strategy records are never deleted';
  end if;
  if tg_table_name = 'quarterly_objectives' then v_q := old.quarter_id;
  elsif tg_table_name = 'key_results' then
    select quarter_id into v_q from quarterly_objectives where id = old.objective_id;
  else
    select o.quarter_id into v_q from key_results k join quarterly_objectives o on o.id = k.objective_id where k.id = old.key_result_id;
  end if;
  if quarter_is_locked(v_q) then raise exception 'QUARTER_LOCKED'; end if;
  return new;
end $$;
create trigger quarterly_objectives_guard before update or delete on quarterly_objectives for each row execute function guard_strategy_row();
create trigger key_results_guard         before update or delete on key_results         for each row execute function guard_strategy_row();
create trigger sub_key_results_guard     before update or delete on sub_key_results     for each row execute function guard_strategy_row();

-- ---------------------------------------------------------------- strategy operations
create or replace function create_annual_theme(p_actor uuid, p_year int, p_theme text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_org uuid;
begin
  perform require_permission(p_actor, 'strategy.annual_theme.create');
  select id into v_org from organisations limit 1;
  if v_org is null then raise exception 'ORGANISATION_NOT_CONFIGURED'; end if;
  begin
    insert into annual_themes (organisation_id, year, theme, created_by) values (v_org, p_year, btrim(p_theme), p_actor) returning id into v_id;
  exception when unique_violation then raise exception 'ANNUAL_THEME_EXISTS'; end;
  perform write_audit(p_actor, 'ANNUAL_THEME_CREATED', 'annual_theme', v_id::text, null, jsonb_build_object('year', p_year, 'theme', btrim(p_theme)));
  return v_id;
end $$;

create or replace function change_annual_theme(p_actor uuid, p_theme_id uuid, p_new_theme text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old text;
begin
  perform require_permission(p_actor, 'strategy.annual_theme.change_exception');
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  select theme into v_old from annual_themes where id = p_theme_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into annual_theme_changes (annual_theme_id, old_theme, new_theme, reason, changed_by)
    values (p_theme_id, v_old, btrim(p_new_theme), btrim(p_reason), p_actor);
  update annual_themes set theme = btrim(p_new_theme), updated_at = app_now() where id = p_theme_id;
  perform write_audit(p_actor, 'ANNUAL_THEME_CHANGED', 'annual_theme', p_theme_id::text,
    jsonb_build_object('theme', v_old), jsonb_build_object('theme', btrim(p_new_theme)), btrim(p_reason));
end $$;

create or replace function create_year_quarters(p_actor uuid, p_year int) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_n int := 0; q int; v_start date; v_count int;
begin
  perform require_permission(p_actor, 'strategy.quarter.manage');
  select id into v_org from organisations limit 1;
  for q in 1..4 loop
    v_start := make_date(p_year, (q - 1) * 3 + 1, 1);
    insert into quarters (organisation_id, year, quarter_number, starts_on, ends_on)
      values (v_org, p_year, q, v_start, (v_start + interval '3 months' - interval '1 day')::date)
      on conflict do nothing;
    get diagnostics v_count = row_count; v_n := v_n + v_count;
  end loop;
  if v_n > 0 then perform write_audit(p_actor, 'QUARTERS_CREATED', 'quarter', p_year::text, null, jsonb_build_object('year', p_year, 'created', v_n)); end if;
  return v_n;
end $$;

create or replace function assert_quarter_editable(p_quarter_id uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from quarters where id = p_quarter_id) then raise exception 'NOT_FOUND'; end if;
  if quarter_is_locked(p_quarter_id) then raise exception 'QUARTER_LOCKED'; end if;
end $$;

create or replace function create_objective(p_actor uuid, p_quarter_id uuid, p_title text, p_description text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform require_permission(p_actor, 'strategy.objective.create');
  perform assert_quarter_editable(p_quarter_id);
  begin
    insert into quarterly_objectives (quarter_id, title, description, created_by) values (p_quarter_id, btrim(p_title), p_description, p_actor) returning id into v_id;
  exception when unique_violation then raise exception 'OBJECTIVE_EXISTS'; end;
  perform write_audit(p_actor, 'OBJECTIVE_CREATED', 'quarterly_objective', v_id::text, null, jsonb_build_object('title', btrim(p_title), 'quarter_id', p_quarter_id));
  return v_id;
end $$;

create or replace function update_objective(p_actor uuid, p_id uuid, p_title text, p_description text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old quarterly_objectives;
begin
  perform require_permission(p_actor, 'strategy.objective.edit');
  select * into v_old from quarterly_objectives where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform assert_quarter_editable(v_old.quarter_id);
  update quarterly_objectives set title = btrim(p_title), description = p_description, updated_at = app_now() where id = p_id;
  perform write_audit(p_actor, 'OBJECTIVE_UPDATED', 'quarterly_objective', p_id::text,
    jsonb_build_object('title', v_old.title, 'description', v_old.description), jsonb_build_object('title', btrim(p_title), 'description', p_description));
end $$;

create or replace function create_key_result(p_actor uuid, p_objective_id uuid, p_title text, p_description text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_q uuid; v_seq int; v_id uuid;
begin
  perform require_permission(p_actor, 'strategy.kr.create');
  select quarter_id into v_q from quarterly_objectives where id = p_objective_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform assert_quarter_editable(v_q);
  select coalesce(max(sequence), 0) + 1 into v_seq from key_results where objective_id = p_objective_id;
  if v_seq > 4 then raise exception 'KR_LIMIT_EXCEEDED' using detail = 'A quarter may contain at most 4 key results'; end if;
  insert into key_results (objective_id, sequence, code, title, description) values (p_objective_id, v_seq, 'KR' || v_seq, btrim(p_title), p_description) returning id into v_id;
  perform write_audit(p_actor, 'KR_CREATED', 'key_result', v_id::text, null, jsonb_build_object('code', 'KR' || v_seq, 'title', btrim(p_title)));
  return v_id;
end $$;

create or replace function update_key_result(p_actor uuid, p_id uuid, p_title text, p_description text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old key_results; v_q uuid;
begin
  perform require_permission(p_actor, 'strategy.kr.edit');
  select * into v_old from key_results where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select quarter_id into v_q from quarterly_objectives where id = v_old.objective_id;
  perform assert_quarter_editable(v_q);
  update key_results set title = btrim(p_title), description = p_description, updated_at = app_now() where id = p_id;
  perform write_audit(p_actor, 'KR_UPDATED', 'key_result', p_id::text,
    jsonb_build_object('title', v_old.title, 'description', v_old.description), jsonb_build_object('title', btrim(p_title), 'description', p_description));
end $$;

create or replace function create_sub_key_result(p_actor uuid, p_kr_id uuid, p_title text, p_description text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_kr key_results; v_q uuid; v_seq int; v_id uuid;
begin
  perform require_permission(p_actor, 'strategy.subkr.create');
  select * into v_kr from key_results where id = p_kr_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select quarter_id into v_q from quarterly_objectives where id = v_kr.objective_id;
  perform assert_quarter_editable(v_q);
  select coalesce(max(sequence), 0) + 1 into v_seq from sub_key_results where key_result_id = p_kr_id;
  insert into sub_key_results (key_result_id, sequence, code, title, description)
    values (p_kr_id, v_seq, v_kr.code || '.' || v_seq, btrim(p_title), p_description) returning id into v_id;
  perform write_audit(p_actor, 'SUBKR_CREATED', 'sub_key_result', v_id::text, null, jsonb_build_object('code', v_kr.code || '.' || v_seq, 'title', btrim(p_title)));
  return v_id;
end $$;

create or replace function update_sub_key_result(p_actor uuid, p_id uuid, p_title text, p_description text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old sub_key_results; v_q uuid;
begin
  perform require_permission(p_actor, 'strategy.subkr.edit');
  select * into v_old from sub_key_results where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select o.quarter_id into v_q from key_results k join quarterly_objectives o on o.id = k.objective_id where k.id = v_old.key_result_id;
  perform assert_quarter_editable(v_q);
  update sub_key_results set title = btrim(p_title), description = p_description, updated_at = app_now() where id = p_id;
  perform write_audit(p_actor, 'SUBKR_UPDATED', 'sub_key_result', p_id::text,
    jsonb_build_object('title', v_old.title, 'description', v_old.description), jsonb_build_object('title', btrim(p_title), 'description', p_description));
end $$;

-- Readiness: objective, 3–4 KRs, every KR with >= 1 Sub-KR. Returns the list of blockers (empty = ready).
create or replace function quarter_readiness(p_quarter_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_obj uuid; v_krs int; v_blockers jsonb := '[]'::jsonb; r record;
begin
  select id into v_obj from quarterly_objectives where quarter_id = p_quarter_id;
  if v_obj is null then return jsonb_build_array('OBJECTIVE_MISSING'); end if;
  select count(*) into v_krs from key_results where objective_id = v_obj;
  if v_krs < 3 then v_blockers := v_blockers || to_jsonb('KR_COUNT_BELOW_MINIMUM (' || v_krs || ' of 3–4)'::text); end if;
  if v_krs > 4 then v_blockers := v_blockers || to_jsonb('KR_COUNT_ABOVE_MAXIMUM'::text); end if;
  for r in select k.code from key_results k where k.objective_id = v_obj
           and not exists (select 1 from sub_key_results s where s.key_result_id = k.id) order by k.sequence loop
    v_blockers := v_blockers || to_jsonb(r.code || ' has no Sub-KR');
  end loop;
  return v_blockers;
end $$;

create or replace function activate_quarter(p_actor uuid, p_quarter_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_q quarters; v_blockers jsonb;
begin
  perform require_permission(p_actor, 'strategy.quarter.manage');
  select * into v_q from quarters where id = p_quarter_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_q.status <> 'PLANNED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'Quarter is ' || v_q.status; end if;
  if quarter_is_locked(p_quarter_id) then raise exception 'QUARTER_LOCKED'; end if;
  v_blockers := quarter_readiness(p_quarter_id);
  if jsonb_array_length(v_blockers) > 0 then raise exception 'QUARTER_NOT_READY' using detail = v_blockers::text; end if;
  update quarters set status = 'ACTIVE', activated_at = app_now() where id = p_quarter_id;
  perform write_audit(p_actor, 'QUARTER_ACTIVATED', 'quarter', p_quarter_id::text, jsonb_build_object('status', 'PLANNED'), jsonb_build_object('status', 'ACTIVE'));
end $$;

-- ---------------------------------------------------------------- reporting calendar
create table reporting_weeks (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete restrict,
  quarter_id      uuid not null references quarters(id) on delete restrict,
  week_year       int  not null,
  week_number     int  not null,
  week_start_at   timestamptz not null,
  week_end_at     timestamptz not null,
  content_lock_at timestamptz not null,
  final_lock_at   timestamptz not null,
  status          text not null default 'SCHEDULED' check (status in ('SCHEDULED','OPEN','FINAL_LOCKED')),
  reporting_state text not null default 'NORMAL' check (reporting_state in ('NORMAL','ORGANIZATION_HOLIDAY')),
  finalized_at    timestamptz,
  created_at      timestamptz not null default app_now(),
  unique (organisation_id, week_start_at),
  check (week_end_at > week_start_at and content_lock_at > week_start_at and final_lock_at > content_lock_at)
);
create index reporting_weeks_quarter_idx on reporting_weeks (quarter_id);
create index reporting_weeks_final_idx on reporting_weeks (final_lock_at) where status <> 'FINAL_LOCKED';

create table reporting_week_state_events (
  id              uuid primary key default gen_random_uuid(),
  reporting_week_id uuid not null references reporting_weeks(id) on delete restrict,
  prior_state     text not null,
  new_state       text not null,
  reason          text not null check (btrim(reason) <> ''),
  actor_user_id   uuid not null references users(id),
  idempotency_key text not null unique,
  created_at      timestamptz not null default app_now()
);
create trigger reporting_week_state_events_immutable before update or delete on reporting_week_state_events
  for each row execute function forbid_mutation();

-- Only the privileged declaration function may flip reporting_state.
create or replace function guard_reporting_week() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD'; end if;
  if new.week_start_at <> old.week_start_at or new.content_lock_at <> old.content_lock_at
     or new.final_lock_at <> old.final_lock_at or new.quarter_id <> old.quarter_id then
    raise exception 'IMMUTABLE_RECORD' using detail = 'reporting week schedule is immutable';
  end if;
  if new.reporting_state <> old.reporting_state and coalesce(current_setting('app.holiday_declaration', true), '') <> 'on' then
    raise exception 'PERMISSION_DENIED' using detail = 'reporting_state may only change through the holiday operation';
  end if;
  return new;
end $$;
create trigger reporting_weeks_guard before update or delete on reporting_weeks for each row execute function guard_reporting_week();

create table governance_sessions (
  id              uuid primary key default gen_random_uuid(),
  reporting_week_id uuid not null unique references reporting_weeks(id) on delete restrict,
  session_date    date not null,
  outcome         text not null default 'SCHEDULED' check (outcome in ('SCHEDULED','HELD','SKIPPED')),
  outcome_at      timestamptz,
  outcome_by      uuid references users(id),
  skip_operation_ref uuid unique,
  staff_tagged_count int,
  notes           text,
  created_at      timestamptz not null default app_now(),
  updated_at      timestamptz not null default app_now()
);

-- Idempotently create the reporting week containing p_date (Monday-based, WAT).
create or replace function ensure_reporting_week(p_date date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_monday date := date_trunc('week', p_date::timestamp)::date;
  v_start timestamptz := v_monday::timestamp at time zone 'Africa/Lagos';
  v_id uuid; v_q uuid; v_org uuid;
begin
  select id into v_id from reporting_weeks where week_start_at = v_start;
  if v_id is not null then return v_id; end if;
  select id into v_org from organisations limit 1;
  select id into v_q from quarters where starts_on <= v_monday and ends_on >= v_monday and organisation_id = v_org;
  if v_q is null then raise exception 'QUARTER_NOT_FOUND' using detail = 'No quarter covers ' || v_monday; end if;
  insert into reporting_weeks (organisation_id, quarter_id, week_year, week_number, week_start_at, week_end_at, content_lock_at, final_lock_at)
  values (v_org, v_q, extract(isoyear from v_monday)::int, extract(week from v_monday)::int, v_start,
          (v_monday + 7)::timestamp at time zone 'Africa/Lagos',
          ((v_monday + 1)::timestamp + interval '18 hours') at time zone 'Africa/Lagos',
          ((v_monday + 8)::timestamp + interval '11 hours') at time zone 'Africa/Lagos')
  returning id into v_id;
  return v_id;
end $$;

create or replace function manage_reporting_week(p_actor uuid, p_date date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform require_permission(p_actor, 'reporting.week.manage');
  v_id := ensure_reporting_week(p_date);
  perform write_audit(p_actor, 'REPORTING_WEEK_ENSURED', 'reporting_week', v_id::text, null, jsonb_build_object('date', p_date));
  return v_id;
end $$;

-- Derived lifecycle phase (ADR-036): never trust a status column for lock decisions.
create or replace function report_phase(p_week_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when w.status = 'FINAL_LOCKED' or app_now() >= w.final_lock_at then 'FINAL_LOCKED'
    when app_now() >= w.content_lock_at then 'CONTENT_LOCKED'
    when app_now() >= w.week_start_at then 'OPEN'
    else 'NOT_OPEN' end
  from reporting_weeks w where w.id = p_week_id;
$$;

-- Organisation Holiday (ADR-033). Whole reporting weeks only; post-lock changes need the amendment path.
create or replace function declare_organization_holiday(
  p_actor uuid, p_week_ids uuid[], p_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_w reporting_weeks; v_id uuid; v_changed jsonb := '[]'::jsonb; v_existing int; v_audit uuid;
begin
  perform require_permission(p_actor, 'reporting.period.holiday.manage');
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  if p_week_ids is null or cardinality(p_week_ids) = 0 then raise exception 'VALIDATION_ERROR' using detail = 'at least one week required'; end if;

  select count(*) into v_existing from reporting_week_state_events where idempotency_key like p_idempotency_key || ':%';
  if v_existing > 0 then
    return jsonb_build_object('replayed', true, 'weeks', (select coalesce(jsonb_agg(reporting_week_id), '[]'::jsonb)
             from reporting_week_state_events where idempotency_key like p_idempotency_key || ':%'));
  end if;

  perform set_config('app.holiday_declaration', 'on', true);
  foreach v_id in array p_week_ids loop
    select * into v_w from reporting_weeks where id = v_id for update;
    if not found then raise exception 'NOT_FOUND' using detail = v_id::text; end if;
    if v_w.reporting_state = 'ORGANIZATION_HOLIDAY' then continue; end if;
    if report_phase(v_id) = 'FINAL_LOCKED' or exists (select 1 from weekly_reports where reporting_week_id = v_id and submission_status = 'SUBMITTED') then
      raise exception 'HOLIDAY_AMENDMENT_REQUIRED' using detail = 'week already has reports or is locked; use the controlled amendment path';
    end if;
    update reporting_weeks set reporting_state = 'ORGANIZATION_HOLIDAY' where id = v_id;
    insert into reporting_week_state_events (reporting_week_id, prior_state, new_state, reason, actor_user_id, idempotency_key)
      values (v_id, 'NORMAL', 'ORGANIZATION_HOLIDAY', btrim(p_reason), p_actor, p_idempotency_key || ':' || v_id);
    v_changed := v_changed || to_jsonb(v_id);
  end loop;
  perform set_config('app.holiday_declaration', 'off', true);

  v_audit := write_audit(p_actor, 'ORGANIZATION_HOLIDAY_DECLARED', 'reporting_week', null, jsonb_build_object('state', 'NORMAL'),
                         jsonb_build_object('state', 'ORGANIZATION_HOLIDAY', 'week_ids', v_changed), btrim(p_reason));
  perform notify_users(users_with_role('BU_LEAD'), 'ORGANIZATION_HOLIDAY', 'reporting_week', null,
    'Organisation holiday declared', 'No weekly report is due for the declared reporting week(s). Report reminders and missing-report penalties are suppressed.',
    'holiday:' || p_idempotency_key);
  return jsonb_build_object('replayed', false, 'weeks', v_changed, 'audit_id', v_audit);
end $$;

select lock_down_function_grants();
