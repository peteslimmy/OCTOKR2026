-- Scoring snapshots, compliance, integrity corrections, final lock, quarterly scores, scheduled jobs.

create table weekly_score_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  business_unit_id    uuid not null references business_units(id) on delete restrict,
  reporting_week_id   uuid not null references reporting_weeks(id) on delete restrict,
  weekly_report_id    uuid references weekly_reports(id) on delete restrict,
  version_number      int  not null check (version_number >= 1),
  score_state         text not null check (score_state in ('SCORED','NOT_SUBMITTED')),
  total_goals         int  not null default 0,
  done_goals          int  not null default 0,
  base_score          numeric not null check (base_score between 0 and 100),
  applied_penalty_rates jsonb not null default '[]'::jsonb,
  combined_penalty_rate numeric not null default 0 check (combined_penalty_rate >= 0),
  penalty_amount      numeric(7,2) not null default 0,
  final_score         numeric(5,2) not null check (final_score between 0 and 100),
  calculation_version text not null,
  reason              text not null check (reason in ('FINAL_LOCK','INTEGRITY_CORRECTION')),
  integrity_correction_id uuid,
  calculated_at       timestamptz not null default app_now(),
  unique (business_unit_id, reporting_week_id, version_number)
);
create trigger weekly_score_snapshots_immutable before update or delete on weekly_score_snapshots for each row execute function forbid_mutation();

create table weekly_compliance (
  id                uuid primary key default gen_random_uuid(),
  business_unit_id  uuid not null references business_units(id) on delete restrict,
  reporting_week_id uuid not null references reporting_weeks(id) on delete restrict,
  weekly_report_id  uuid references weekly_reports(id) on delete restrict,
  status            text not null check (status in ('COMPLIANT','NON_COMPLIANT')),
  reason            text not null,
  determined_at     timestamptz not null default app_now(),
  unique (business_unit_id, reporting_week_id)
);
create trigger weekly_compliance_immutable before update or delete on weekly_compliance for each row execute function forbid_mutation();

create table integrity_penalty_configurations (
  id             uuid primary key default gen_random_uuid(),
  rate           numeric(6,5) not null check (rate > 0 and rate <= 1),
  effective_from timestamptz not null default app_now(),
  effective_to   timestamptz,
  created_by     uuid not null references users(id),
  created_at     timestamptz not null default app_now()
);

create table integrity_corrections (
  id                uuid primary key default gen_random_uuid(),
  task_id           uuid not null references tasks(id) on delete restrict,
  weekly_report_id  uuid not null references weekly_reports(id) on delete restrict,
  business_unit_id  uuid not null references business_units(id) on delete restrict,
  from_status       text not null check (from_status in ('DONE','NOT_DONE')),
  to_status         text not null check (to_status in ('DONE','NOT_DONE')),
  reason            text not null check (btrim(reason) <> ''),
  penalty_decision  text not null check (penalty_decision in ('NONE','APPLY','WAIVE')),
  penalty_rate      numeric(6,5),
  penalty_config_id uuid references integrity_penalty_configurations(id),
  waiver_reason     text,
  actor_user_id     uuid not null references users(id),
  actor_role        text,
  idempotency_key   text not null unique,
  score_before      numeric(5,2),
  created_at        timestamptz not null default app_now(),
  check (from_status <> to_status),
  check ((penalty_decision = 'APPLY' and penalty_rate is not null) or (penalty_decision <> 'APPLY')),
  check (penalty_decision <> 'WAIVE' or (waiver_reason is not null and btrim(waiver_reason) <> '')),
  check ((from_status = 'DONE' and to_status = 'NOT_DONE' and penalty_decision in ('APPLY','WAIVE'))
      or (from_status = 'NOT_DONE' and to_status = 'DONE' and penalty_decision = 'NONE'))
);
create index integrity_corrections_report_idx on integrity_corrections (weekly_report_id);
create trigger integrity_corrections_immutable before update or delete on integrity_corrections for each row execute function forbid_mutation();
alter table task_status_history add constraint task_status_history_correction_fk
  foreign key (integrity_correction_id) references integrity_corrections(id) on delete restrict;

create table quarterly_score_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  quarter_id           uuid not null references quarters(id) on delete restrict,
  business_unit_id     uuid not null references business_units(id) on delete restrict,
  version_number       int  not null check (version_number >= 1),
  calculation_status   text not null check (calculation_status in ('PROVISIONAL','FINAL')),
  score                numeric(5,2),
  score_reason         text,
  denominator_count    int  not null,
  numerator            numeric not null,
  missing_report_zero_count int not null default 0,
  excluded_holiday_count int not null default 0,
  week_contributions   jsonb not null,
  rule_version         text not null,
  calculated_at        timestamptz not null default app_now(),
  prior_snapshot_id    uuid references quarterly_score_snapshots(id),
  source               text not null check (source in ('SCHEDULER','AMENDMENT')),
  amendment_id         uuid,
  unique (quarter_id, business_unit_id, version_number),
  check (score is not null or score_reason = 'NO_ELIGIBLE_REPORTING_WEEKS')
);
create trigger quarterly_score_snapshots_immutable before update or delete on quarterly_score_snapshots for each row execute function forbid_mutation();

-- ---------------------------------------------------------------- pure scoring
create or replace function calc_base_score(p_done int, p_total int) returns numeric
language sql immutable as $$ select case when p_total <= 0 then 0::numeric else (p_done::numeric * 100) / p_total end $$;

-- finalScore = round2(max(0, base * (1 - combinedRate)))   (ADR-012)
create or replace function calc_final_score(p_base numeric, p_combined_rate numeric) returns numeric
language sql immutable as $$ select round(greatest(0::numeric, p_base * (1 - p_combined_rate)), 2) $$;

create or replace function bu_lead_ids(p_bu uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct u.id), '{}') from users u
  join employees e on e.id = u.employee_id join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id
  where e.business_unit_id = p_bu and r.code = 'BU_LEAD' and u.status = 'ACTIVE';
$$;

create or replace function active_penalty_rate() returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select rate from integrity_penalty_configurations
  where effective_from <= app_now() and (effective_to is null or effective_to > app_now())
  order by effective_from desc limit 1;
$$;

create or replace function set_integrity_penalty_rate(p_actor uuid, p_rate numeric) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_prev numeric;
begin
  perform require_permission(p_actor, 'integrity_penalty.configure');
  if p_rate is null or p_rate <= 0 or p_rate > 1 then raise exception 'VALIDATION_ERROR' using detail = 'rate must be a decimal in (0, 1]'; end if;
  v_prev := active_penalty_rate();
  update integrity_penalty_configurations set effective_to = app_now() where effective_to is null;
  insert into integrity_penalty_configurations (rate, created_by) values (p_rate, p_actor) returning id into v_id;
  perform write_audit(p_actor, 'PENALTY_RATE_CONFIGURED', 'integrity_penalty_configuration', v_id::text,
    jsonb_build_object('rate', v_prev), jsonb_build_object('rate', p_rate));
  return v_id;
end $$;

-- ---------------------------------------------------------------- weekly snapshots
create or replace function create_weekly_snapshot(
  p_bu uuid, p_week uuid, p_report uuid, p_reason text, p_correction uuid default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_version int; v_total int := 0; v_done int := 0; v_base numeric := 0; v_rates jsonb := '[]'::jsonb;
  v_combined numeric := 0; v_final numeric; v_state text; v_submitted boolean := false; v_id uuid;
begin
  select coalesce(max(version_number), 0) + 1 into v_version from weekly_score_snapshots where business_unit_id = p_bu and reporting_week_id = p_week;
  if p_report is not null then
    select total_goals, done_goals into v_total, v_done from report_goal_counts(p_report);
    select submission_status = 'SUBMITTED' into v_submitted from weekly_reports where id = p_report;
  end if;
  if v_submitted then
    v_state := 'SCORED';
    v_base := calc_base_score(v_done, v_total);
    select coalesce(jsonb_agg(jsonb_build_object('correction_id', id, 'rate', penalty_rate) order by created_at), '[]'::jsonb),
           coalesce(sum(penalty_rate), 0)
      into v_rates, v_combined
      from integrity_corrections where weekly_report_id = p_report and penalty_decision = 'APPLY';
    v_final := calc_final_score(v_base, v_combined);
  else
    v_state := 'NOT_SUBMITTED'; v_base := 0; v_final := 0;   -- BR-SCORE-005
  end if;
  insert into weekly_score_snapshots (business_unit_id, reporting_week_id, weekly_report_id, version_number, score_state, total_goals, done_goals,
      base_score, applied_penalty_rates, combined_penalty_rate, penalty_amount, final_score, calculation_version, reason, integrity_correction_id)
  values (p_bu, p_week, p_report, v_version, v_state, v_total, v_done, v_base, v_rates, v_combined,
          round(v_base - v_base * (1 - least(v_combined, 1)), 2), v_final, 'weekly-rules-1.0.0', p_reason, p_correction)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- quarterly calculation (ADR-032 / ADR-033)
create or replace function ensure_quarter_weeks(p_quarter_id uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare q quarters; d date; n int := 0;
begin
  select * into q from quarters where id = p_quarter_id;
  d := date_trunc('week', q.starts_on::timestamp)::date;
  if d < q.starts_on then d := d + 7; end if;           -- a week belongs to the quarter containing its Monday
  while d <= q.ends_on loop
    perform ensure_reporting_week(d); n := n + 1; d := d + 7;
  end loop;
  return n;
end $$;

create or replace function calculate_quarterly_score(p_quarter_id uuid, p_bu uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r record; v_contrib jsonb := '[]'::jsonb; v_excluded jsonb := '[]'::jsonb;
  v_den int := 0; v_num numeric := 0; v_missing int := 0; v_pending int := 0; v_unreviewed int := 0;
  v_snap weekly_score_snapshots; v_rep weekly_reports; v_skipped boolean; v_score numeric; v_status text;
  v_bu_created timestamptz;
begin
  select created_at into v_bu_created from business_units where id = p_bu;
  for r in select * from reporting_weeks w where w.quarter_id = p_quarter_id order by w.week_start_at loop
    if v_bu_created >= r.week_end_at then continue; end if;      -- BU did not yet exist (assumption, ADR-042)
    if r.reporting_state = 'ORGANIZATION_HOLIDAY' then
      v_excluded := v_excluded || jsonb_build_object('week_id', r.id, 'week_start_at', r.week_start_at, 'reason', 'ORGANIZATION_HOLIDAY');
      continue;
    end if;
    v_den := v_den + 1;
    select * into v_snap from weekly_score_snapshots where business_unit_id = p_bu and reporting_week_id = r.id order by version_number desc limit 1;
    select * into v_rep from weekly_reports where business_unit_id = p_bu and reporting_week_id = r.id;
    select exists (select 1 from governance_sessions s where s.reporting_week_id = r.id and s.outcome = 'SKIPPED') into v_skipped;
    if v_snap.id is null then
      v_pending := v_pending + 1;
      v_contrib := v_contrib || jsonb_build_object('week_id', r.id, 'week_start_at', r.week_start_at, 'value', 0, 'state', 'PENDING', 'session_skipped', v_skipped);
    else
      v_num := v_num + v_snap.final_score;
      if v_snap.score_state = 'NOT_SUBMITTED' then v_missing := v_missing + 1; end if;
      if v_snap.score_state = 'SCORED' and v_rep.review_status = 'NOT_REVIEWED' then v_unreviewed := v_unreviewed + 1; end if;
      v_contrib := v_contrib || jsonb_build_object('week_id', r.id, 'week_start_at', r.week_start_at, 'value', v_snap.final_score,
        'state', case when v_snap.score_state = 'NOT_SUBMITTED' then 'MISSING_ZERO' when v_rep.review_status = 'REVIEWED' then 'REVIEWED' else 'AWAITING_REVIEW' end,
        'snapshot_id', v_snap.id, 'snapshot_version', v_snap.version_number, 'session_skipped', v_skipped);
    end if;
  end loop;
  if v_den = 0 then
    return jsonb_build_object('score', null, 'score_reason', 'NO_ELIGIBLE_REPORTING_WEEKS', 'denominator_count', 0, 'numerator', 0,
      'missing_report_zero_count', 0, 'excluded_holiday_count', jsonb_array_length(v_excluded), 'contributions', v_contrib,
      'excluded_weeks', v_excluded, 'calculation_status', 'PROVISIONAL');
  end if;
  v_score := round(v_num / v_den, 2);
  v_status := case when quarter_is_locked(p_quarter_id) and v_pending = 0 and v_unreviewed = 0 then 'FINAL' else 'PROVISIONAL' end;
  return jsonb_build_object('score', v_score, 'score_reason', null, 'denominator_count', v_den, 'numerator', v_num,
    'missing_report_zero_count', v_missing, 'excluded_holiday_count', jsonb_array_length(v_excluded), 'contributions', v_contrib,
    'excluded_weeks', v_excluded, 'calculation_status', v_status, 'pending_weeks', v_pending, 'awaiting_review', v_unreviewed);
end $$;

create or replace function snapshot_quarterly_scores(p_quarter_id uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare b record; c jsonb; last quarterly_score_snapshots; v_n int := 0; v_ver int;
begin
  for b in select id from business_units where status = 'ACTIVE' and reports_weekly loop
    c := calculate_quarterly_score(p_quarter_id, b.id);
    select * into last from quarterly_score_snapshots where quarter_id = p_quarter_id and business_unit_id = b.id order by version_number desc limit 1;
    if last.id is not null and last.week_contributions = (c->'contributions') and last.calculation_status = c->>'calculation_status'
       and last.score is not distinct from (c->>'score')::numeric and last.denominator_count = (c->>'denominator_count')::int
       and last.excluded_holiday_count = (c->>'excluded_holiday_count')::int then
      continue;
    end if;
    v_ver := coalesce(last.version_number, 0) + 1;
    insert into quarterly_score_snapshots (quarter_id, business_unit_id, version_number, calculation_status, score, score_reason, denominator_count,
        numerator, missing_report_zero_count, excluded_holiday_count, week_contributions, rule_version, prior_snapshot_id, source)
    values (p_quarter_id, b.id, v_ver, c->>'calculation_status', (c->>'score')::numeric, c->>'score_reason', (c->>'denominator_count')::int,
        (c->>'numerator')::numeric, (c->>'missing_report_zero_count')::int, (c->>'excluded_holiday_count')::int, c->'contributions',
        'quarterly-rules-1.0.0', last.id, 'SCHEDULER');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------- final lock (system operation)
create or replace function finalize_reporting_week(p_week_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w reporting_weeks; r record; b record; t record; v_reports int := 0; v_missing int := 0; v_flipped int := 0; v_snap uuid;
begin
  select * into w from reporting_weeks where id = p_week_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if w.status = 'FINAL_LOCKED' then return jsonb_build_object('already_final_locked', true); end if;
  if app_now() < w.final_lock_at then raise exception 'FINAL_LOCK_NOT_DUE'; end if;

  for r in select * from weekly_reports where reporting_week_id = p_week_id for update loop
    for t in select tk.id from tasks tk join smart_goals g on g.id = tk.smart_goal_id
             where g.weekly_report_id = r.id and tk.deleted_at is null and tk.status = 'UNDEFINED' loop
      update tasks set status = 'NOT_DONE', updated_at = app_now() where id = t.id;
      insert into task_status_history (task_id, from_status, to_status, change_source) values (t.id, 'UNDEFINED', 'NOT_DONE', 'SYSTEM_FINAL_LOCK');
      v_flipped := v_flipped + 1;
    end loop;
    update weekly_reports set status = 'FINAL_LOCKED', content_locked_at = coalesce(content_locked_at, w.content_lock_at),
           final_locked_at = app_now(), updated_at = app_now() where id = r.id;
    update report_edit_sessions set status = 'EXPIRED', ended_at = app_now() where weekly_report_id = r.id and status = 'ACTIVE';
    if w.reporting_state = 'NORMAL' then
      v_snap := create_weekly_snapshot(r.business_unit_id, p_week_id, r.id, 'FINAL_LOCK');
      insert into weekly_compliance (business_unit_id, reporting_week_id, weekly_report_id, status, reason)
        values (r.business_unit_id, p_week_id, r.id,
                case when r.submission_status = 'SUBMITTED' then 'COMPLIANT' else 'NON_COMPLIANT' end,
                case when r.submission_status = 'SUBMITTED' then 'REPORT_SUBMITTED' else 'NOT_SUBMITTED_AT_FINAL_LOCK' end)
        on conflict do nothing;
      if r.submission_status <> 'SUBMITTED' then v_missing := v_missing + 1; end if;
    end if;
    v_reports := v_reports + 1;
  end loop;

  if w.reporting_state = 'NORMAL' then
    for b in select id from business_units where status = 'ACTIVE' and reports_weekly and created_at < w.week_end_at
             and not exists (select 1 from weekly_reports x where x.business_unit_id = business_units.id and x.reporting_week_id = p_week_id) loop
      perform create_weekly_snapshot(b.id, p_week_id, null, 'FINAL_LOCK');
      insert into weekly_compliance (business_unit_id, reporting_week_id, weekly_report_id, status, reason)
        values (b.id, p_week_id, null, 'NON_COMPLIANT', 'NO_REPORT_AT_FINAL_LOCK') on conflict do nothing;
      v_missing := v_missing + 1;
    end loop;
  end if;

  update reporting_weeks set status = 'FINAL_LOCKED', finalized_at = app_now() where id = p_week_id;
  perform write_audit(null, 'REPORTING_WEEK_FINAL_LOCKED', 'reporting_week', p_week_id::text, null,
    jsonb_build_object('reports', v_reports, 'missing', v_missing, 'tasks_set_not_done', v_flipped, 'reporting_state', w.reporting_state));
  if w.reporting_state = 'NORMAL' then
    perform notify_users(users_with_role('BU_LEAD'), 'FINAL_LOCKED', 'reporting_week', p_week_id::text, 'Weekly report finalised',
      'The weekly reporting window has closed and scores are final.', 'final-lock:' || p_week_id);
  end if;
  perform snapshot_quarterly_scores(w.quarter_id);
  return jsonb_build_object('already_final_locked', false, 'reports', v_reports, 'missing', v_missing, 'tasks_set_not_done', v_flipped);
end $$;

-- ---------------------------------------------------------------- integrity correction
create or replace function integrity_correction_preview(p_actor uuid, p_task_id uuid, p_target text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_t tasks; v_g smart_goals; v_r weekly_reports; v_total int; v_done int; v_goal_done boolean;
  v_new_done int; v_base_now numeric; v_applied numeric; v_rate numeric := active_penalty_rate(); v_base_new numeric;
begin
  perform require_permission(p_actor, 'integrity_correction.create');
  select * into v_t from tasks where id = p_task_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_g from smart_goals where id = v_t.smart_goal_id;
  select * into v_r from weekly_reports where id = v_g.weekly_report_id;
  select total_goals, done_goals into v_total, v_done from report_goal_counts(v_r.id);
  v_goal_done := goal_is_done(v_g.id);
  -- goal status if the task flipped
  v_new_done := v_done - (case when v_goal_done then 1 else 0 end)
    + (case when exists (select 1 from tasks x where x.smart_goal_id = v_g.id and x.deleted_at is null)
             and not exists (select 1 from tasks x where x.smart_goal_id = v_g.id and x.deleted_at is null and x.id <> p_task_id and x.status <> 'DONE')
             and p_target = 'DONE' then 1 else 0 end);
  v_base_now := calc_base_score(v_done, v_total);
  v_base_new := calc_base_score(v_new_done, v_total);
  select coalesce(sum(penalty_rate), 0) into v_applied from integrity_corrections where weekly_report_id = v_r.id and penalty_decision = 'APPLY';
  return jsonb_build_object(
    'task_status', v_t.status, 'target_status', p_target, 'total_goals', v_total, 'done_goals_before', v_done, 'done_goals_after', v_new_done,
    'base_score_before', round(v_base_now, 2), 'base_score_after', round(v_base_new, 2),
    'configured_penalty_rate', v_rate, 'already_applied_rate', v_applied,
    'final_if_waived', calc_final_score(v_base_new, v_applied),
    'final_if_applied', case when v_rate is null then null else calc_final_score(v_base_new, v_applied + v_rate) end,
    'penalty_applicable', (v_t.status = 'DONE' and p_target = 'NOT_DONE'));
end $$;

create or replace function create_integrity_correction(
  p_actor uuid, p_task_id uuid, p_target_status text, p_reason text,
  p_penalty_decision text, p_waiver_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_t tasks; v_g smart_goals; v_r weekly_reports; v_w reporting_weeks; v_existing integrity_corrections; v_rate numeric;
  v_cfg uuid; v_id uuid; v_decision text; v_phase text; v_before numeric; v_after numeric; v_snap_exists boolean;
  v_old_snap weekly_score_snapshots; v_new_snap uuid; v_role text;
begin
  perform require_permission(p_actor, 'integrity_correction.create');
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_existing from integrity_corrections where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.actor_user_id <> p_actor or v_existing.task_id <> p_task_id then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('correction_id', v_existing.id, 'replayed', true);
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'INTEGRITY_REASON_REQUIRED'; end if;

  select * into v_t from tasks where id = p_task_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_g from smart_goals where id = v_t.smart_goal_id;
  select * into v_r from weekly_reports where id = v_g.weekly_report_id for update;
  select * into v_w from reporting_weeks where id = v_r.reporting_week_id;
  if v_w.reporting_state = 'ORGANIZATION_HOLIDAY' then raise exception 'REPORTING_NOT_REQUIRED'; end if;
  v_phase := report_phase(v_w.id);
  if v_phase in ('NOT_OPEN','OPEN') then raise exception 'CORRECTION_NOT_AVAILABLE' using detail = 'Integrity corrections apply after content lock'; end if;
  if v_phase = 'FINAL_LOCKED' and quarter_is_locked(v_w.quarter_id) then raise exception 'QUARTER_LOCKED'; end if;

  if not ((v_t.status = 'DONE' and p_target_status = 'NOT_DONE') or (v_t.status = 'NOT_DONE' and p_target_status = 'DONE')) then
    raise exception 'INVALID_STATE_TRANSITION' using detail = v_t.status || ' -> ' || p_target_status;
  end if;

  if v_t.status = 'DONE' then
    if p_penalty_decision is null or p_penalty_decision not in ('APPLY','WAIVE') then raise exception 'PENALTY_DECISION_REQUIRED'; end if;
    v_decision := p_penalty_decision;
    if v_decision = 'WAIVE' then
      perform require_permission(p_actor, 'integrity_penalty.waive');
      if p_waiver_reason is null or btrim(p_waiver_reason) = '' then raise exception 'WAIVER_REASON_REQUIRED'; end if;
    else
      v_rate := active_penalty_rate();
      if v_rate is null then raise exception 'PENALTY_CONFIG_MISSING' using detail = 'An Admin must configure the integrity penalty rate first'; end if;
      select id into v_cfg from integrity_penalty_configurations where effective_to is null order by effective_from desc limit 1;
    end if;
  else
    v_decision := 'NONE';
  end if;

  select * into v_old_snap from weekly_score_snapshots where business_unit_id = v_r.business_unit_id and reporting_week_id = v_w.id order by version_number desc limit 1;
  v_snap_exists := v_old_snap.id is not null;
  v_before := v_old_snap.final_score;
  v_role := array_to_string(actor_role_codes(p_actor), ',');

  perform set_config('app.integrity_correction', 'on', true);
  update tasks set status = p_target_status, updated_at = app_now() where id = p_task_id;
  perform set_config('app.integrity_correction', 'off', true);

  insert into integrity_corrections (task_id, weekly_report_id, business_unit_id, from_status, to_status, reason, penalty_decision, penalty_rate,
      penalty_config_id, waiver_reason, actor_user_id, actor_role, idempotency_key, score_before)
  values (p_task_id, v_r.id, v_r.business_unit_id, v_t.status, p_target_status, btrim(p_reason), v_decision,
      case when v_decision = 'APPLY' then v_rate end, v_cfg, nullif(btrim(p_waiver_reason), ''), p_actor, v_role, p_idempotency_key, v_before)
  returning id into v_id;
  insert into task_status_history (task_id, from_status, to_status, change_source, changed_by, integrity_correction_id)
    values (p_task_id, v_t.status, p_target_status, 'INTEGRITY_CORRECTION', p_actor, v_id);

  if v_snap_exists and v_old_snap.score_state = 'SCORED' then
    v_new_snap := create_weekly_snapshot(v_r.business_unit_id, v_w.id, v_r.id, 'INTEGRITY_CORRECTION', v_id);
    select final_score into v_after from weekly_score_snapshots where id = v_new_snap;
    perform snapshot_quarterly_scores(v_w.quarter_id);
  end if;

  perform write_audit(p_actor, 'INTEGRITY_CORRECTION', 'task', p_task_id::text,
    jsonb_build_object('status', v_t.status, 'score', v_before),
    jsonb_build_object('status', p_target_status, 'score', v_after, 'penalty_decision', v_decision, 'penalty_rate', v_rate, 'correction_id', v_id),
    btrim(p_reason), v_r.business_unit_id);
  if v_decision = 'APPLY' then
    perform write_audit(p_actor, 'PENALTY_APPLIED', 'integrity_correction', v_id::text, null, jsonb_build_object('rate', v_rate), btrim(p_reason), v_r.business_unit_id);
  elsif v_decision = 'WAIVE' then
    perform write_audit(p_actor, 'PENALTY_WAIVED', 'integrity_correction', v_id::text, null, null, btrim(p_waiver_reason), v_r.business_unit_id);
  end if;
  perform notify_users(bu_lead_ids(v_r.business_unit_id), 'INTEGRITY_CORRECTION', 'integrity_correction', v_id::text, 'Integrity correction recorded',
    'A task status was corrected through the integrity workflow. Reason: ' || btrim(p_reason), 'ic:' || v_id);
  return jsonb_build_object('correction_id', v_id, 'replayed', false, 'penalty_decision', v_decision, 'penalty_rate', v_rate,
                            'score_before', v_before, 'score_after', v_after, 'snapshot_id', v_new_snap);
end $$;

-- ---------------------------------------------------------------- scheduled jobs (idempotent, retryable)
create or replace function roll_quarters() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare q record; v_locked int := 0; v_activated int := 0; v_blockers jsonb;
begin
  for q in select * from quarters where status = 'ACTIVE' and quarter_is_locked(id) loop
    update quarters set status = 'LOCKED', locked_at = app_now() where id = q.id;
    perform write_audit(null, 'QUARTER_LOCKED', 'quarter', q.id::text, jsonb_build_object('status', 'ACTIVE'), jsonb_build_object('status', 'LOCKED'));
    perform snapshot_quarterly_scores(q.id);
    v_locked := v_locked + 1;
  end loop;
  for q in select * from quarters where status = 'PLANNED' and not quarter_is_locked(id)
           and app_now() >= (starts_on::timestamp at time zone 'Africa/Lagos') loop
    v_blockers := quarter_readiness(q.id);
    if jsonb_array_length(v_blockers) = 0 then
      update quarters set status = 'ACTIVE', activated_at = app_now() where id = q.id;
      perform ensure_quarter_weeks(q.id);
      perform write_audit(null, 'QUARTER_ACTIVATED', 'quarter', q.id::text, jsonb_build_object('status', 'PLANNED'), jsonb_build_object('status', 'ACTIVE'));
      v_activated := v_activated + 1;
    else
      perform notify_users(users_with_permission('strategy.quarter.manage'), 'QUARTER_NOT_READY', 'quarter', q.id::text, 'Quarter cannot be activated',
        'The quarter has started but is incomplete: ' || v_blockers::text, 'qnr:' || q.id || ':' || current_date);
    end if;
  end loop;
  return jsonb_build_object('locked', v_locked, 'activated', v_activated);
end $$;

create or replace function run_scheduled_jobs() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w record; v_result jsonb := '{}'::jsonb; v_final int := 0; v_content int := 0; v_roll jsonb; v_err text;
begin
  -- 1. quarter roll (lock/activate); activation also materialises the calendar weeks
  begin v_roll := roll_quarters(); v_result := v_result || jsonb_build_object('quarters', v_roll);
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform write_audit(null, 'JOB_FAILED', 'job', 'roll_quarters', null, jsonb_build_object('error', v_err), null, null, 'FAILURE');
  end;
  for w in select id from quarters where status = 'ACTIVE' loop perform ensure_quarter_weeks(w.id); end loop;
  -- 2. content-lock processing (status mirror + audit); enforcement never depends on this
  for w in select * from reporting_weeks where status <> 'FINAL_LOCKED' and app_now() >= content_lock_at loop
    update weekly_reports set status = 'CONTENT_LOCKED', content_locked_at = coalesce(content_locked_at, w.content_lock_at), updated_at = app_now()
     where reporting_week_id = w.id and status = 'OPEN';
    if found then
      perform write_audit(null, 'REPORTING_WEEK_CONTENT_LOCKED', 'reporting_week', w.id::text, null, null);
      v_content := v_content + 1;
    end if;
    update reporting_weeks set status = 'OPEN' where id = w.id and status = 'SCHEDULED';
  end loop;
  -- 3. final lock processing, one transaction per week (savepoint) so one failure does not block others
  for w in select id from reporting_weeks where status <> 'FINAL_LOCKED' and app_now() >= final_lock_at order by final_lock_at loop
    begin
      perform finalize_reporting_week(w.id); v_final := v_final + 1;
    exception when others then
      get stacked diagnostics v_err = message_text;
      perform write_audit(null, 'JOB_FAILED', 'reporting_week', w.id::text, null, jsonb_build_object('error', v_err), null, null, 'FAILURE');
    end;
  end loop;
  return v_result || jsonb_build_object('content_locked_weeks', v_content, 'finalized_weeks', v_final);
end $$;

-- activate_quarter materialises its calendar weeks (needed for a fixed quarterly denominator and advance holidays)
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
  perform ensure_quarter_weeks(p_quarter_id);
  perform write_audit(p_actor, 'QUARTER_ACTIVATED', 'quarter', p_quarter_id::text, jsonb_build_object('status', 'PLANNED'), jsonb_build_object('status', 'ACTIVE'));
end $$;

select lock_down_function_grants();
