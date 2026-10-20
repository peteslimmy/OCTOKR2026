-- Milestone 6: Intelligent Reports foundation (ADR-053).
-- Read-only analytics over the authoritative snapshots and workflow tables. Nothing here recalculates a score: weekly and quarterly
-- results come from weekly_score_snapshots / quarterly_score_snapshots exactly as the scoring engine wrote them. Every read function
-- is SECURITY INVOKER, so row-level security (and auth_can_view_bu for BU scope) limits what each caller sees.

-- ---------------------------------------------------------------- permissions (inside the existing RBAC)
insert into permissions (code, description) values
  ('reports.view',     'Open the Reports module'),
  ('reports.export',   'Export report results (CSV, Excel, PDF)'),
  ('reports.build',    'Save, share and duplicate report configurations'),
  ('reports.snapshot', 'Create immutable official report snapshots (organisation-wide scope)');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values
  ('SUPER_ADMIN','reports.view'),('ADMIN','reports.view'),('EXECUTIVE','reports.view'),('DIRECTOR','reports.view'),('PRESENTER','reports.view'),
  ('BU_LEAD','reports.view'),('HR','reports.view'),('FINANCE','reports.view'),
  ('SUPER_ADMIN','reports.export'),('ADMIN','reports.export'),('EXECUTIVE','reports.export'),('DIRECTOR','reports.export'),('PRESENTER','reports.export'),
  ('BU_LEAD','reports.export'),('HR','reports.export'),('FINANCE','reports.export'),
  ('SUPER_ADMIN','reports.build'),('ADMIN','reports.build'),('EXECUTIVE','reports.build'),('DIRECTOR','reports.build'),('PRESENTER','reports.build'),
  ('BU_LEAD','reports.build'),('HR','reports.build'),('FINANCE','reports.build'),
  ('SUPER_ADMIN','reports.snapshot'),('ADMIN','reports.snapshot'),('EXECUTIVE','reports.snapshot'),('DIRECTOR','reports.snapshot')
) as g(role_code, perm) join roles r on r.code = g.role_code join permissions p on p.code = g.perm;

-- ---------------------------------------------------------------- weekly results by BU and week
-- One row per expected BU per reporting week of the quarter. The score is the latest weekly snapshot; compliance is the recorded
-- compliance determination; late-report exceptions are shown separately and never rewrite compliance (decision 2).
create or replace function read_report_weekly_scores(p_quarter_id uuid, p_bu uuid default null) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.week_start_at, t.business_unit), '[]'::jsonb) from (
    select b.id as business_unit_id, b.code as bu_code, b.name as business_unit,
           w.id as reporting_week_id, w.week_number, w.week_year, w.week_start_at, w.content_lock_at, w.final_lock_at,
           w.status as week_status, w.reporting_state,
           case when w.reporting_state = 'ORGANIZATION_HOLIDAY' then 'HOLIDAY'
                when s.id is null then 'PENDING' else s.score_state end as result_state,
           s.final_score, s.base_score, s.version_number as snapshot_version, s.combined_penalty_rate,
           c.status as compliance_status, c.reason as compliance_reason,
           r.id as weekly_report_id, r.submission_status, r.submitted_at, r.review_status,
           (r.submitted_at is not null and r.submitted_at <= w.content_lock_at) as submitted_before_content_lock,
           e.status as late_exception_status
    from reporting_weeks w
    join business_units b on b.status = 'ACTIVE' and b.reports_weekly and b.created_at < w.week_end_at
                         and (p_bu is null or b.id = p_bu) and auth_can_view_bu(b.id)
    left join lateral (select * from weekly_score_snapshots x where x.business_unit_id = b.id and x.reporting_week_id = w.id
                       order by x.version_number desc limit 1) s on true
    left join weekly_compliance c on c.business_unit_id = b.id and c.reporting_week_id = w.id
    left join weekly_reports r on r.business_unit_id = b.id and r.reporting_week_id = w.id
    left join late_report_exceptions e on e.business_unit_id = b.id and e.reporting_week_id = w.id and e.status in ('AUTHORISED','SUBMITTED','APPLIED')
    where w.quarter_id = p_quarter_id
  ) t;
$$;

-- ---------------------------------------------------------------- quarterly results with the previous quarter for comparison
create or replace function read_report_quarter_scores(p_quarter_id uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.score desc nulls last, t.business_unit), '[]'::jsonb) from (
    select b.id as business_unit_id, b.code as bu_code, b.name as business_unit,
           cur.version_number, cur.calculation_status, cur.score, cur.score_reason, cur.denominator_count, cur.numerator,
           cur.missing_report_zero_count, cur.excluded_holiday_count, cur.source, cur.calculated_at,
           (select count(*)::int from quarterly_score_snapshots v where v.quarter_id = p_quarter_id and v.business_unit_id = b.id) as versions,
           pq.id as previous_quarter_id, pq.year as previous_year, pq.quarter_number as previous_quarter_number,
           prev.score as previous_score, prev.version_number as previous_version
    from quarters q
    join business_units b on b.status = 'ACTIVE' and b.reports_weekly and auth_can_view_bu(b.id)
    left join lateral (select * from quarterly_score_snapshots z where z.quarter_id = q.id and z.business_unit_id = b.id
                       order by z.version_number desc limit 1) cur on true
    left join lateral (select id, year, quarter_number from quarters x where (x.year, x.quarter_number) < (q.year, q.quarter_number)
                       order by x.year desc, x.quarter_number desc limit 1) pq on true
    left join lateral (select * from quarterly_score_snapshots z where z.quarter_id = pq.id and z.business_unit_id = b.id
                       order by z.version_number desc limit 1) prev on true
    where q.id = p_quarter_id
  ) t;
$$;

-- ---------------------------------------------------------------- Sub-KR execution by week (same definition as read_strategy_tree)
-- execution = goals done / goals mapped, over final-locked, submitted reports; weekly counts let the module show progress velocity.
create or replace function read_report_kr_execution(p_quarter_id uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.kr_sequence, t.sub_sequence, t.week_start_at), '[]'::jsonb) from (
    select k.id as key_result_id, k.code as kr_code, k.title as kr_title, k.sequence as kr_sequence,
           s.id as sub_key_result_id, s.code as sub_code, s.title as sub_title, s.sequence as sub_sequence,
           w.id as reporting_week_id, w.week_number, w.week_start_at,
           count(g.id)::int as mapped_goals,
           count(g.id) filter (where goal_is_done(g.id))::int as done_goals
    from quarterly_objectives o
    join key_results k on k.objective_id = o.id
    join sub_key_results s on s.key_result_id = k.id
    join reporting_weeks w on w.quarter_id = o.quarter_id and w.status = 'FINAL_LOCKED'
    left join weekly_reports r on r.reporting_week_id = w.id and r.status = 'FINAL_LOCKED' and r.submission_status = 'SUBMITTED'
                              and auth_can_view_bu(r.business_unit_id)
    left join smart_goals g on g.weekly_report_id = r.id and g.sub_key_result_id = s.id and g.deleted_at is null
    where o.quarter_id = p_quarter_id
    group by k.id, k.code, k.title, k.sequence, s.id, s.code, s.title, s.sequence, w.id, w.week_number, w.week_start_at
  ) t;
$$;

-- ---------------------------------------------------------------- outstanding governance items
-- Priority is a transparent age rule (pending business approval): over 7 days HIGH, over 3 days MEDIUM, otherwise LOW.
create or replace function read_report_governance_items() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.age_days desc, t.category), '[]'::jsonb) from (
    select u.*, case when u.age_days > 7 then 'HIGH' when u.age_days > 3 then 'MEDIUM' else 'LOW' end as priority from (
      select 'ATTENDANCE_AMENDMENT'::text as category, r.id::text as ref_id, 'Attendance amendment awaiting decision'::text as title,
             r.status as status, r.requested_at as since,
             (select e.first_name || ' ' || e.last_name from users x join employees e on e.id = x.employee_id where x.id = r.requested_by) as owner,
             '/governance/amendments'::text as path,
             floor(extract(epoch from (app_now() - r.requested_at)) / 86400)::int as age_days
        from attendance_amendment_requests r where r.status = 'PENDING'
      union all
      select 'DISBURSEMENT', d.id::text, 'Disbursement request ' || lower(replace(d.status, '_', ' ')), d.status, d.created_at,
             (select e.first_name || ' ' || e.last_name from users x join employees e on e.id = x.employee_id where x.id = d.requested_by),
             '/finance', floor(extract(epoch from (app_now() - d.created_at)) / 86400)::int
        from disbursement_requests d where d.status in ('SUBMITTED','UNDER_REVIEW','APPROVED')
      union all
      select 'LATE_REPORT', l.id::text, 'Late-report exception ' || lower(l.status), l.status, l.authorised_at,
             (select e.first_name || ' ' || e.last_name from users x join employees e on e.id = x.employee_id where x.id = l.authorised_by),
             '/governance/late-reports', floor(extract(epoch from (app_now() - l.authorised_at)) / 86400)::int
        from late_report_exceptions l where l.status in ('AUTHORISED','SUBMITTED')
      union all
      select 'REPORT_REVIEW', r.id::text, 'Final-locked report not yet reviewed', r.review_status, r.final_locked_at,
             (select b.name from business_units b where b.id = r.business_unit_id),
             '/weekly/' || r.id::text, floor(extract(epoch from (app_now() - r.final_locked_at)) / 86400)::int
        from weekly_reports r where r.status = 'FINAL_LOCKED' and r.submission_status = 'SUBMITTED' and r.review_status = 'NOT_REVIEWED'
              and auth_has_any(array['weekly_report.review','weekly_report.view_all'])
      union all
      select 'FINAL_LOCK_PENDING', w.id::text, 'Week past its final lock but not yet finalised', w.status, w.final_lock_at, null::text, '/governance',
             floor(extract(epoch from (app_now() - w.final_lock_at)) / 86400)::int
        from reporting_weeks w where w.status <> 'FINAL_LOCKED' and app_now() >= w.final_lock_at and auth_has_permission('weekly_report.view_all')
    ) u
  ) t;
$$;

-- ---------------------------------------------------------------- integrity corrections
create or replace function read_report_integrity(p_quarter_id uuid, p_bu uuid default null) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) from (
    select ic.id, ic.created_at, b.name as business_unit, w.week_number, w.week_year, w.week_start_at, ic.from_status, ic.to_status, ic.penalty_decision,
           ic.penalty_rate, ic.reason, ic.score_before,
           (select e.first_name || ' ' || e.last_name from users x join employees e on e.id = x.employee_id where x.id = ic.actor_user_id) as actor,
           ic.weekly_report_id
    from integrity_corrections ic
    join weekly_reports r on r.id = ic.weekly_report_id
    join reporting_weeks w on w.id = r.reporting_week_id
    join business_units b on b.id = ic.business_unit_id
    where w.quarter_id = p_quarter_id and (p_bu is null or ic.business_unit_id = p_bu) and auth_can_view_bu(ic.business_unit_id)
  ) t;
$$;

-- ---------------------------------------------------------------- holiday history (organisation-wide record)
create or replace function read_report_holidays(p_quarter_id uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.week_start_at), '[]'::jsonb) from (
    select w.id as reporting_week_id, w.week_number, w.week_year, w.week_start_at, w.status as week_status, w.reporting_state,
           (select count(*)::int from reporting_week_state_events ev where ev.reporting_week_id = w.id) as state_changes,
           (select ev.reason from reporting_week_state_events ev where ev.reporting_week_id = w.id order by ev.created_at desc limit 1) as latest_reason,
           (select count(*)::int from holiday_amendments a where a.reporting_week_id = w.id) as post_lock_amendments
    from reporting_weeks w
    where w.quarter_id = p_quarter_id
      and (w.reporting_state = 'ORGANIZATION_HOLIDAY' or exists (select 1 from reporting_week_state_events ev where ev.reporting_week_id = w.id))
  ) t;
$$;

-- ---------------------------------------------------------------- violation fund actuals by month (actuals only; no projections exist)
create or replace function read_report_finance(p_from date, p_to date) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with bounds as (select p_from as f, p_to as t),
  opening as (
    select coalesce(sum(case entry_type when 'CREDIT' then amount else -amount end), 0) as amt
    from financial_ledger_entries, bounds
    where (created_at at time zone 'Africa/Lagos')::date < bounds.f),
  months as (
    select date_trunc('month', (created_at at time zone 'Africa/Lagos'))::date as month,
           coalesce(sum(amount) filter (where entry_type = 'CREDIT'), 0) as credits,
           coalesce(sum(amount) filter (where entry_type = 'DEBIT'), 0) as debits,
           count(*)::int as entries
    from financial_ledger_entries, bounds
    where (created_at at time zone 'Africa/Lagos')::date between bounds.f and bounds.t
    group by 1),
  viol as (
    select date_trunc('month', (created_at at time zone 'Africa/Lagos'))::date as month, count(*)::int as raised, coalesce(sum(fine_amount), 0) as fines
    from violations, bounds where (created_at at time zone 'Africa/Lagos')::date between bounds.f and bounds.t group by 1),
  keys as (select month from months union select month from viol)
  -- what a role cannot read is returned as null (blank), never as zero
  select coalesce(jsonb_agg(to_jsonb(x) order by x.month), '[]'::jsonb) from (
    select k.month,
           case when auth_has_permission('finance.ledger.view') then coalesce(m.credits, 0) end as credits,
           case when auth_has_permission('finance.ledger.view') then coalesce(m.debits, 0) end as debits,
           case when auth_has_permission('finance.ledger.view') then coalesce(m.credits, 0) - coalesce(m.debits, 0) end as net,
           case when auth_has_permission('finance.ledger.view') then (select amt from opening) + sum(coalesce(m.credits, 0) - coalesce(m.debits, 0)) over (order by k.month) end as closing_balance,
           case when auth_has_permission('finance.ledger.view') then coalesce(m.entries, 0) end as ledger_entries,
           case when auth_has_any(array['violation.create','violation.edit']) then coalesce(v.raised, 0) end as violations_raised,
           case when auth_has_any(array['violation.create','violation.edit']) then coalesce(v.fines, 0) end as fines_raised
    from keys k left join months m on m.month = k.month left join viol v on v.month = k.month
  ) x;
$$;

create or replace function read_report_disbursement_status() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('status', status, 'requests', n, 'amount', amt) order by status), '[]'::jsonb)
  from (select status, count(*)::int as n, coalesce(sum(amount), 0) as amt from disbursement_requests group by status) s;
$$;

-- ---------------------------------------------------------------- data-quality checks
create or replace function read_report_data_quality(p_quarter_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_q quarters; v_weeks int; v_expected int; v_missing_snap int; v_unreviewed int; v_nonreporting int; v_pending int;
        v_prov int; v_out jsonb := '[]'::jsonb;
begin
  if not auth_has_permission('weekly_report.view_all') then raise exception 'PERMISSION_DENIED' using detail = 'data-quality checks are organisation-wide'; end if;
  select * into v_q from quarters where id = p_quarter_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select count(*)::int into v_weeks from reporting_weeks where quarter_id = p_quarter_id;
  v_expected := (select count(*)::int from generate_series(date_trunc('week', v_q.starts_on::timestamp)::date + (case when date_trunc('week', v_q.starts_on::timestamp)::date < v_q.starts_on then 7 else 0 end), v_q.ends_on, interval '7 days'));
  select count(*)::int into v_missing_snap from reporting_weeks w
    join business_units b on b.status = 'ACTIVE' and b.reports_weekly and b.created_at < w.week_end_at
    where w.quarter_id = p_quarter_id and w.status = 'FINAL_LOCKED' and w.reporting_state = 'NORMAL'
      and not exists (select 1 from weekly_score_snapshots s where s.business_unit_id = b.id and s.reporting_week_id = w.id);
  select count(*)::int into v_unreviewed from weekly_reports r join reporting_weeks w on w.id = r.reporting_week_id
    where w.quarter_id = p_quarter_id and r.status = 'FINAL_LOCKED' and r.submission_status = 'SUBMITTED' and r.review_status = 'NOT_REVIEWED'
      and app_now() > r.final_locked_at + interval '7 days';
  select count(*)::int into v_nonreporting from business_units where status = 'ACTIVE' and not reports_weekly;
  select count(*)::int into v_pending from reporting_weeks where quarter_id = p_quarter_id and status <> 'FINAL_LOCKED' and reporting_state = 'NORMAL';
  select count(*)::int into v_prov from (select distinct on (business_unit_id) calculation_status from quarterly_score_snapshots
      where quarter_id = p_quarter_id order by business_unit_id, version_number desc) x where x.calculation_status = 'PROVISIONAL';
  v_out := jsonb_build_array(
    jsonb_build_object('check', 'Calendar weeks materialised for the quarter', 'severity', case when v_weeks = v_expected then 'OK' else 'WARNING' end,
      'count', v_expected - v_weeks, 'detail', v_weeks || ' of ' || v_expected || ' expected reporting weeks exist'),
    jsonb_build_object('check', 'Final-locked weeks missing a weekly score for an expected BU', 'severity', case when v_missing_snap = 0 then 'OK' else 'CRITICAL' end,
      'count', v_missing_snap, 'detail', 'Every expected BU should have a weekly snapshot once a week is final-locked'),
    jsonb_build_object('check', 'Submitted reports unreviewed more than 7 days after final lock', 'severity', case when v_unreviewed = 0 then 'OK' else 'WARNING' end,
      'count', v_unreviewed, 'detail', 'Unreviewed reports keep quarterly scores PROVISIONAL'),
    jsonb_build_object('check', 'Quarterly scores still PROVISIONAL', 'severity', case when v_prov = 0 then 'OK' else 'INFO' end,
      'count', v_prov, 'detail', 'Provisional until the quarter is locked and every week is finalised and reviewed'),
    jsonb_build_object('check', 'Weeks not yet finalised', 'severity', 'INFO', 'count', v_pending, 'detail', 'Excluded from trend lines until scored'),
    jsonb_build_object('check', 'Active BUs excluded from weekly reporting', 'severity', 'INFO', 'count', v_nonreporting,
      'detail', 'Units with reports_weekly switched off do not appear in scores, rankings or compliance'));
  return v_out;
end $$;

-- ---------------------------------------------------------------- saved report configurations
create table saved_reports (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references users(id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  report_id    text not null,
  definition_version text not null,
  params       jsonb not null default '{}'::jsonb,
  columns      jsonb,
  sort_by      jsonb,
  shared_with  uuid[] not null default '{}',
  created_at   timestamptz not null default app_now(),
  updated_at   timestamptz not null default app_now()
);
create index saved_reports_owner_idx on saved_reports (owner_id);

-- Official snapshots: parameters, definition version, scope and a checksum of the result, immutable.
create table report_snapshots (
  id            uuid primary key default gen_random_uuid(),
  report_id     text not null,
  definition_version text not null,
  title         text not null check (btrim(title) <> ''),
  params        jsonb not null,
  scope         text not null,
  result        jsonb not null,
  row_count     int not null,
  checksum      text not null,
  generated_by  uuid not null references users(id),
  generated_at  timestamptz not null default app_now(),
  note          text
);
create index report_snapshots_idx on report_snapshots (report_id, generated_at desc);
create trigger report_snapshots_immutable before update or delete on report_snapshots for each row execute function forbid_mutation();

create or replace function save_report(
  p_actor uuid, p_id uuid, p_name text, p_report_id text, p_version text, p_params jsonb, p_columns jsonb, p_sort jsonb, p_shared_with uuid[]
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_u uuid; v_audit text;
begin
  perform require_permission(p_actor, 'reports.build');
  if p_name is null or btrim(p_name) = '' then raise exception 'VALIDATION_ERROR' using detail = 'a name is required'; end if;
  -- sharing hands over the *definition* only; recipients still see their own scope, and must themselves be allowed to open reports
  foreach v_u in array coalesce(p_shared_with, '{}') loop
    if v_u = p_actor then continue; end if;
    if not actor_has_permission(v_u, 'reports.view') then raise exception 'VALIDATION_ERROR' using detail = 'a recipient cannot open reports'; end if;
  end loop;
  if p_id is null then
    insert into saved_reports (owner_id, name, report_id, definition_version, params, columns, sort_by, shared_with)
      values (p_actor, btrim(p_name), p_report_id, p_version, coalesce(p_params, '{}'::jsonb), p_columns, p_sort, coalesce(p_shared_with, '{}')) returning id into v_id;
    v_audit := 'SAVED_REPORT_CREATED';
  else
    update saved_reports set name = btrim(p_name), params = coalesce(p_params, '{}'::jsonb), columns = p_columns, sort_by = p_sort,
           shared_with = coalesce(p_shared_with, '{}'), definition_version = p_version, updated_at = app_now()
     where id = p_id and owner_id = p_actor returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
    v_audit := 'SAVED_REPORT_UPDATED';
  end if;
  perform write_audit(p_actor, v_audit, 'saved_report', v_id::text, null,
    jsonb_build_object('report_id', p_report_id, 'shared_with_count', cardinality(coalesce(p_shared_with, '{}'))));
  return v_id;
end $$;

create or replace function delete_saved_report(p_actor uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_permission(p_actor, 'reports.build');
  delete from saved_reports where id = p_id and owner_id = p_actor;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform write_audit(p_actor, 'SAVED_REPORT_DELETED', 'saved_report', p_id::text);
end $$;

create or replace function create_report_snapshot(
  p_actor uuid, p_report_id text, p_version text, p_title text, p_params jsonb, p_scope text, p_result jsonb, p_row_count int, p_checksum text, p_note text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform require_permission(p_actor, 'reports.snapshot');
  -- official snapshots hold organisation-wide results only, so they can be shown to any holder of that scope without leaking a narrower view
  perform require_permission(p_actor, 'weekly_report.view_all');
  if p_scope <> 'ORGANISATION' then raise exception 'VALIDATION_ERROR' using detail = 'snapshots are organisation-wide'; end if;
  insert into report_snapshots (report_id, definition_version, title, params, scope, result, row_count, checksum, generated_by, note)
    values (p_report_id, p_version, btrim(p_title), p_params, p_scope, p_result, p_row_count, p_checksum, p_actor, nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_id;
  perform write_audit(p_actor, 'REPORT_SNAPSHOT_CREATED', 'report_snapshot', v_id::text, null,
    jsonb_build_object('report_id', p_report_id, 'definition_version', p_version, 'rows', p_row_count, 'checksum', p_checksum));
  return v_id;
end $$;

-- Official exports are recorded: who, which report, which parameters, in which format, how many rows (never the data itself).
create or replace function record_report_export(p_actor uuid, p_report_id text, p_format text, p_params jsonb, p_row_count int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_permission(p_actor, 'reports.export');
  if p_format not in ('CSV','XLSX','PDF') then raise exception 'VALIDATION_ERROR'; end if;
  perform write_audit(p_actor, 'REPORT_EXPORTED', 'report', p_report_id, null,
    jsonb_build_object('format', p_format, 'rows', p_row_count, 'params', p_params));
end $$;

-- ---------------------------------------------------------------- "Last Week" presenter hint (ADR-055)
-- For the week being presented and one Business Unit: the tasks recorded as NOT_DONE in the week that immediately precedes it on the
-- calendar (exactly seven days earlier in the organisation's time zone; never "the previous row", so a gap is reported, not skipped).
-- Read-only and SECURITY INVOKER: row-level security and auth_can_view_bu decide what the caller may see, so a manipulated BU or
-- week id returns an error or nothing, never another unit's tasks. Nothing is written.
create or replace function read_previous_week_outstanding(p_week_id uuid, p_bu_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  cur reporting_weeks; prev reporting_weeks; v_bu business_units; v_prev_start timestamptz; v_report uuid; v_tasks jsonb; v_undef int := 0;
  v_avail text;
begin
  select * into cur from reporting_weeks where id = p_week_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_bu from business_units where id = p_bu_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not auth_can_view_bu(p_bu_id) then raise exception 'PERMISSION_DENIED' using detail = 'business unit not in your scope'; end if;

  v_prev_start := (((cur.week_start_at at time zone 'Africa/Lagos')::date - 7)::timestamp) at time zone 'Africa/Lagos';
  select * into prev from reporting_weeks where organisation_id = cur.organisation_id and week_start_at = v_prev_start;
  if not found then
    return jsonb_build_object('availability', 'NO_PREVIOUS_WEEK',
      'current_week', jsonb_build_object('id', cur.id, 'week_number', cur.week_number, 'week_year', cur.week_year, 'week_start_at', cur.week_start_at),
      'previous_week', jsonb_build_object('week_start_at', v_prev_start),
      'business_unit', jsonb_build_object('id', v_bu.id, 'name', v_bu.name), 'tasks', '[]'::jsonb, 'final_locked', null, 'undefined_tasks', 0);
  end if;

  select r.id into v_report from weekly_reports r where r.business_unit_id = p_bu_id and r.reporting_week_id = prev.id;
  v_avail := case when prev.reporting_state = 'ORGANIZATION_HOLIDAY' then 'HOLIDAY' when v_report is null then 'NO_REPORT' else 'OK' end;

  if v_report is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'description', t.description, 'status', t.status, 'goal_title', g.title,
             'goal_type', g.goal_type, 'position', t.position) order by g.position, t.position), '[]'::jsonb)
      into v_tasks
      from tasks t join smart_goals g on g.id = t.smart_goal_id
     where g.weekly_report_id = v_report and t.deleted_at is null and g.deleted_at is null and t.status = 'NOT_DONE';
    select count(*)::int into v_undef from tasks t join smart_goals g on g.id = t.smart_goal_id
     where g.weekly_report_id = v_report and t.deleted_at is null and g.deleted_at is null and t.status = 'UNDEFINED';
  end if;

  return jsonb_build_object('availability', v_avail,
    'current_week', jsonb_build_object('id', cur.id, 'week_number', cur.week_number, 'week_year', cur.week_year, 'week_start_at', cur.week_start_at),
    'previous_week', jsonb_build_object('id', prev.id, 'week_number', prev.week_number, 'week_year', prev.week_year, 'week_start_at', prev.week_start_at, 'status', prev.status),
    'business_unit', jsonb_build_object('id', v_bu.id, 'name', v_bu.name),
    'tasks', coalesce(v_tasks, '[]'::jsonb), 'final_locked', prev.status = 'FINAL_LOCKED', 'undefined_tasks', v_undef);
end $$;

-- ---------------------------------------------------------------- RLS
alter table saved_reports enable row level security;
alter table report_snapshots enable row level security;
grant select on saved_reports, report_snapshots to authenticated;
create policy read_own_or_shared on saved_reports for select to authenticated using (owner_id = auth.uid() or auth.uid() = any(shared_with));
create policy read_org_scope on report_snapshots for select to authenticated using (
  auth_has_permission('reports.snapshot') or (auth_has_permission('reports.view') and auth_has_permission('weekly_report.view_all')));

select lock_down_function_grants();
