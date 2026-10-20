-- Milestone 3b: Organization Holiday amendment and reversal (ADR-033, 04-BUSINESS-RULES, 12-API-CONTRACT "Organization Holiday").
-- The ordinary declaration refuses a week that is final-locked or already has submitted reports (HOLIDAY_AMENDMENT_REQUIRED).
-- This is the controlled path: it declares such a week a holiday, or reverses any holiday, with an explicit permission, a mandatory
-- reason and idempotency. Eligibility changes, so every affected BU gets a NEW quarterly snapshot version (source AMENDMENT);
-- earlier snapshots, weekly snapshots and compliance rows are never changed or deleted.

alter table weekly_score_snapshots drop constraint weekly_score_snapshots_reason_check;
alter table weekly_score_snapshots add constraint weekly_score_snapshots_reason_check
  check (reason in ('FINAL_LOCK','INTEGRITY_CORRECTION','LATE_REPORT_AMENDMENT','HOLIDAY_REVERSAL'));

create table holiday_amendments (
  id               uuid primary key default gen_random_uuid(),
  reporting_week_id uuid not null references reporting_weeks(id) on delete restrict,
  direction        text not null check (direction in ('DECLARE','REVERSE')),
  prior_state      text not null,
  new_state        text not null,
  reason           text not null check (btrim(reason) <> ''),
  actor_user_id    uuid not null references users(id),
  week_final_locked boolean not null,
  quarter_locked   boolean not null,
  backfilled_zero_count int not null default 0,
  impact           jsonb not null default '[]'::jsonb,      -- per BU: old/new quarterly score and version
  idempotency_key  text not null unique,
  audit_id         uuid,
  created_at       timestamptz not null default app_now(),
  check (prior_state <> new_state)
);
create index holiday_amendments_week_idx on holiday_amendments (reporting_week_id, created_at);
create trigger holiday_amendments_immutable before update or delete on holiday_amendments for each row execute function forbid_mutation();

alter table quarterly_score_snapshots add column holiday_amendment_id uuid;
alter table quarterly_score_snapshots add constraint quarterly_score_snapshots_holiday_amendment_fk
  foreign key (holiday_amendment_id) references holiday_amendments(id) on delete restrict deferrable initially deferred;
alter table quarterly_score_snapshots add constraint quarterly_score_snapshots_amendment_ref_chk
  check (source <> 'AMENDMENT' or (amendment_id is not null) <> (holiday_amendment_id is not null));

-- ---------------------------------------------------------------- quarterly snapshots for a holiday amendment
create or replace function snapshot_quarterly_scores_amended(p_quarter_id uuid, p_holiday_amendment_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b record; c jsonb; last quarterly_score_snapshots; v_new uuid; v_out jsonb := '[]'::jsonb;
begin
  for b in select id, name from business_units where status = 'ACTIVE' and reports_weekly loop
    c := calculate_quarterly_score(p_quarter_id, b.id);
    select * into last from quarterly_score_snapshots where quarter_id = p_quarter_id and business_unit_id = b.id order by version_number desc limit 1;
    if last.id is not null and last.week_contributions = (c->'contributions') and last.calculation_status = c->>'calculation_status'
       and last.score is not distinct from (c->>'score')::numeric and last.denominator_count = (c->>'denominator_count')::int
       and last.excluded_holiday_count = (c->>'excluded_holiday_count')::int then
      continue;
    end if;
    insert into quarterly_score_snapshots (quarter_id, business_unit_id, version_number, calculation_status, score, score_reason, denominator_count,
        numerator, missing_report_zero_count, excluded_holiday_count, week_contributions, rule_version, prior_snapshot_id, source, holiday_amendment_id)
    values (p_quarter_id, b.id, coalesce(last.version_number, 0) + 1, c->>'calculation_status', (c->>'score')::numeric, c->>'score_reason',
        (c->>'denominator_count')::int, (c->>'numerator')::numeric, (c->>'missing_report_zero_count')::int, (c->>'excluded_holiday_count')::int,
        c->'contributions', 'quarterly-rules-1.0.0', last.id, 'AMENDMENT', p_holiday_amendment_id)
    returning id into v_new;
    v_out := v_out || jsonb_build_object('business_unit_id', b.id, 'business_unit', b.name, 'old_score', last.score, 'new_score', (c->>'score')::numeric,
                                         'old_version', last.version_number, 'new_version', coalesce(last.version_number, 0) + 1);
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------- the amendment operation
create or replace function amend_organization_holiday(
  p_actor uuid, p_week_id uuid, p_direction text, p_reason text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_w reporting_weeks; v_prior text; v_new text; v_id uuid := gen_random_uuid(); v_final boolean; v_qlocked boolean; v_zeros int := 0;
  v_impact jsonb; v_audit uuid; v_existing holiday_amendments; r record; b record; v_snap uuid;
begin
  perform require_permission(p_actor, 'quarter.score.amend');
  if p_direction is null or p_direction not in ('DECLARE','REVERSE') then raise exception 'VALIDATION_ERROR' using detail = 'direction must be DECLARE or REVERSE'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'REASON_REQUIRED'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'VALIDATION_ERROR' using detail = 'idempotency key required'; end if;
  select * into v_existing from holiday_amendments where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.reporting_week_id <> p_week_id or v_existing.direction <> p_direction then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return jsonb_build_object('replayed', true, 'amendment_id', v_existing.id, 'impact', v_existing.impact);
  end if;

  select * into v_w from reporting_weeks where id = p_week_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if app_now() >= v_w.final_lock_at and v_w.status <> 'FINAL_LOCKED' then raise exception 'FINAL_LOCK_PENDING' using detail = 'the week is still being finalised'; end if;
  v_prior := v_w.reporting_state;
  v_new := case p_direction when 'DECLARE' then 'ORGANIZATION_HOLIDAY' else 'NORMAL' end;
  if v_prior = v_new then raise exception 'INVALID_STATE_TRANSITION' using detail = 'week is already ' || v_prior; end if;
  if (p_direction = 'DECLARE') <> (v_prior = 'NORMAL') then raise exception 'INVALID_STATE_TRANSITION' using detail = p_direction || ' from ' || v_prior; end if;
  if exists (select 1 from late_report_exceptions where reporting_week_id = p_week_id and status in ('AUTHORISED','SUBMITTED')) then
    raise exception 'LATE_EXCEPTION_PENDING' using detail = 'resolve the late-report exception for this week first';
  end if;
  v_final := v_w.status = 'FINAL_LOCKED';
  v_qlocked := quarter_is_locked(v_w.quarter_id);

  perform set_config('app.holiday_declaration', 'on', true);
  update reporting_weeks set reporting_state = v_new where id = p_week_id;
  perform set_config('app.holiday_declaration', 'off', true);

  -- Reversing a holiday on a week that already final-locked makes it reportable retroactively: every expected BU that has no
  -- score yet gets its (submitted) score or a missing-report zero, exactly as final lock would have produced. Existing rows are kept.
  if p_direction = 'REVERSE' and v_final then
    for r in select * from weekly_reports where reporting_week_id = p_week_id loop
      if not exists (select 1 from weekly_score_snapshots where business_unit_id = r.business_unit_id and reporting_week_id = p_week_id) then
        v_snap := create_weekly_snapshot(r.business_unit_id, p_week_id, r.id, 'HOLIDAY_REVERSAL');
        if r.submission_status <> 'SUBMITTED' then v_zeros := v_zeros + 1; end if;
      end if;
      insert into weekly_compliance (business_unit_id, reporting_week_id, weekly_report_id, status, reason)
        values (r.business_unit_id, p_week_id, r.id, case when r.submission_status = 'SUBMITTED' then 'COMPLIANT' else 'NON_COMPLIANT' end,
                case when r.submission_status = 'SUBMITTED' then 'REPORT_SUBMITTED' else 'NOT_SUBMITTED_AT_FINAL_LOCK' end)
        on conflict do nothing;
    end loop;
    for b in select id from business_units where status = 'ACTIVE' and reports_weekly and created_at < v_w.week_end_at
             and not exists (select 1 from weekly_reports x where x.business_unit_id = business_units.id and x.reporting_week_id = p_week_id) loop
      if not exists (select 1 from weekly_score_snapshots where business_unit_id = b.id and reporting_week_id = p_week_id) then
        perform create_weekly_snapshot(b.id, p_week_id, null, 'HOLIDAY_REVERSAL');
        v_zeros := v_zeros + 1;
      end if;
      insert into weekly_compliance (business_unit_id, reporting_week_id, weekly_report_id, status, reason)
        values (b.id, p_week_id, null, 'NON_COMPLIANT', 'NO_REPORT_AT_FINAL_LOCK') on conflict do nothing;
    end loop;
  end if;

  insert into reporting_week_state_events (reporting_week_id, prior_state, new_state, reason, actor_user_id, idempotency_key)
    values (p_week_id, v_prior, v_new, btrim(p_reason), p_actor, p_idempotency_key);

  v_impact := snapshot_quarterly_scores_amended(v_w.quarter_id, v_id);
  v_audit := write_audit(p_actor, case p_direction when 'DECLARE' then 'ORGANIZATION_HOLIDAY_AMENDED_IN' else 'ORGANIZATION_HOLIDAY_REVERSED' end,
    'reporting_week', p_week_id::text, jsonb_build_object('state', v_prior),
    jsonb_build_object('state', v_new, 'week_final_locked', v_final, 'quarter_locked', v_qlocked, 'amendment_id', v_id,
                       'backfilled_zero_count', v_zeros, 'affected_business_units', jsonb_array_length(v_impact)),
    btrim(p_reason));
  insert into holiday_amendments (id, reporting_week_id, direction, prior_state, new_state, reason, actor_user_id, week_final_locked,
                                  quarter_locked, backfilled_zero_count, impact, idempotency_key, audit_id)
    values (v_id, p_week_id, p_direction, v_prior, v_new, btrim(p_reason), p_actor, v_final, v_qlocked, v_zeros, v_impact, p_idempotency_key, v_audit);
  perform notify_users(users_with_role('BU_LEAD'), 'ORGANIZATION_HOLIDAY_AMENDED', 'reporting_week', p_week_id::text,
    case p_direction when 'DECLARE' then 'Organisation holiday applied to a past week' else 'Organisation holiday reversed' end,
    case p_direction when 'DECLARE' then 'A reporting week is now an organisation holiday and is excluded from quarterly scores. Reason: ' || btrim(p_reason)
      else 'A reporting week is no longer an organisation holiday; it counts in quarterly scores again. Reason: ' || btrim(p_reason) end,
    'hol-am:' || v_id);
  return jsonb_build_object('replayed', false, 'amendment_id', v_id, 'direction', p_direction, 'week_final_locked', v_final,
    'quarter_locked', v_qlocked, 'backfilled_zero_count', v_zeros, 'impact', v_impact, 'audit_id', v_audit);
end $$;

-- ---------------------------------------------------------------- read model + RLS
create or replace function read_holiday_amendments() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'direction', a.direction, 'reason', a.reason, 'created_at', a.created_at, 'week_number', w.week_number, 'week_year', w.week_year,
    'reporting_week_id', w.id, 'week_start_at', w.week_start_at, 'week_final_locked', a.week_final_locked, 'quarter_locked', a.quarter_locked,
    'backfilled_zero_count', a.backfilled_zero_count, 'impact', a.impact,
    'actor', (select e.first_name || ' ' || e.last_name from users u join employees e on e.id = u.employee_id where u.id = a.actor_user_id)
  ) order by a.created_at desc), '[]'::jsonb)
  from holiday_amendments a join reporting_weeks w on w.id = a.reporting_week_id;
$$;

alter table holiday_amendments enable row level security;
grant select on holiday_amendments to authenticated;
create policy read_scoped on holiday_amendments for select to authenticated using (
  auth_has_any(array['quarter.score.amend','reporting.period.holiday.manage','weekly_report.view_all']));

-- holiday weeks never show as non-compliant on the executive dashboard, even if a compliance row predates the holiday
create or replace function read_executive_dashboard(p_quarter_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_week uuid; v_rank jsonb; v_noncomp jsonb; v_ic jsonb; v_tree jsonb;
begin
  if not auth_has_permission('dashboard.executive.view') then raise exception 'PERMISSION_DENIED'; end if;
  select id into v_week from reporting_weeks where quarter_id = p_quarter_id and status = 'FINAL_LOCKED' and reporting_state = 'NORMAL' order by week_start_at desc limit 1;
  select coalesce(jsonb_agg(x order by (x->>'quarter_score')::numeric desc nulls last, x->>'name'), '[]'::jsonb) into v_rank from (
    select jsonb_build_object('business_unit_id', b.id, 'name', b.name, 'code', b.code,
      'latest_week_score', (select s.final_score from weekly_score_snapshots s where s.business_unit_id = b.id and s.reporting_week_id = v_week order by version_number desc limit 1),
      'quarter_score', qs.score, 'quarter_status', qs.calculation_status, 'quarter_score_reason', qs.score_reason,
      'quarter_version', qs.version_number, 'missing_report_zero_count', qs.missing_report_zero_count) x
    from business_units b
    left join lateral (select * from quarterly_score_snapshots z where z.business_unit_id = b.id and z.quarter_id = p_quarter_id order by version_number desc limit 1) qs on true
    where b.status = 'ACTIVE' and b.reports_weekly) t;
  select coalesce(jsonb_agg(jsonb_build_object('business_unit', b.name, 'week_start_at', w.week_start_at, 'reason', c.reason) order by w.week_start_at desc), '[]'::jsonb)
    into v_noncomp
    from weekly_compliance c join business_units b on b.id = c.business_unit_id join reporting_weeks w on w.id = c.reporting_week_id
    where c.status = 'NON_COMPLIANT' and w.quarter_id = p_quarter_id and w.reporting_state = 'NORMAL';   -- holiday weeks are not non-compliance
  select jsonb_build_object('total', count(*), 'applied', count(*) filter (where penalty_decision = 'APPLY'), 'waived', count(*) filter (where penalty_decision = 'WAIVE'))
    into v_ic from integrity_corrections ic join weekly_reports r on r.id = ic.weekly_report_id join reporting_weeks w on w.id = r.reporting_week_id where w.quarter_id = p_quarter_id;
  v_tree := read_strategy_tree(p_quarter_id);
  return jsonb_build_object('latest_finalised_week_id', v_week, 'ranking', v_rank, 'non_compliant', v_noncomp, 'integrity', v_ic, 'strategy', v_tree);
end $$;

select lock_down_function_grants();
