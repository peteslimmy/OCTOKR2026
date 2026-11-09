-- Automated OKR report summaries by email (ADR-115).
-- A schedule says which summary (weekly, monthly, quarterly, annual), when, to whom and with which sections. A run is one summary for one
-- period; a delivery is one recipient of one run. The unique (schedule, period) rule on runs is what stops a period being emailed twice.
-- The job reads organisation-wide aggregates through two service-only functions below (a login-based service account cannot pass the
-- second-factor rule that every report read depends on), so nothing personal is read and no new sign-in exists.

-- ---------------------------------------------------------------- permissions
insert into permissions (code, description, protected, reserved, module, risk) values
  ('report_email.manage',  'Create, change, switch off and delete automated report email schedules', false, false, 'Reports & dashboards', 'medium'),
  ('report_email.send',    'Send an automated report email now, and retry failed deliveries',         false, false, 'Reports & dashboards', 'medium'),
  ('report_email.history', 'See the delivery history of automated report emails',                     false, false, 'Reports & dashboards', 'low')
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values
  ('SUPER_ADMIN','report_email.manage'),('ADMIN','report_email.manage'),
  ('SUPER_ADMIN','report_email.send'),  ('ADMIN','report_email.send'),
  ('SUPER_ADMIN','report_email.history'),('ADMIN','report_email.history')
) as g(role_code, perm) join roles r on r.code = g.role_code join permissions p on p.code = g.perm;

-- ---------------------------------------------------------------- tables (service-only: the API reads and writes them after its own permission check)
create table report_email_schedules (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  frequency    text not null check (frequency in ('WEEKLY','MONTHLY','QUARTERLY','ANNUAL')),
  -- weekly: the ISO weekday (1 Monday .. 7 Sunday) it goes out on, after the week ended
  send_weekday int  not null default 1 check (send_weekday between 1 and 7),
  -- monthly, quarterly, annual: the day of the month it goes out on, after the period ended (1..28 so every month has it)
  send_day     int  not null default 1 check (send_day between 1 and 28),
  send_time    time not null default '08:00',
  recipient_ids uuid[] not null default '{}' check (cardinality(recipient_ids) <= 50),
  sections     text[] not null default array['HEADLINES','RANKING','TREND','HIGHLIGHTS','ATTENTION','INSIGHTS'],
  is_active    boolean not null default true,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default app_now(),
  updated_at   timestamptz not null default app_now(),
  check (sections <@ array['HEADLINES','RANKING','TREND','HIGHLIGHTS','ATTENTION','INSIGHTS']::text[])
);

create table report_email_runs (
  id           uuid primary key default gen_random_uuid(),
  schedule_id  uuid not null references report_email_schedules(id) on delete cascade,
  period_key   text not null,            -- e.g. 2026-W44, 2026-10, 2026-Q3, 2026
  period_start date not null,
  period_end   date not null,
  trigger      text not null check (trigger in ('SCHEDULED','MANUAL')),
  status       text not null default 'PENDING' check (status in ('PENDING','SENT','PARTIAL','FAILED','EMPTY')),
  summary      jsonb not null,           -- the figures the email was built from, so a retry sends identical content
  subject      text not null,
  triggered_by uuid references users(id) on delete set null,
  created_at   timestamptz not null default app_now(),
  completed_at timestamptz
);
-- a period is emailed once per schedule, whether the job or a person started it
create unique index report_email_runs_one_per_period on report_email_runs (schedule_id, period_key);
create index report_email_runs_recent on report_email_runs (created_at desc);

create table report_email_deliveries (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references report_email_runs(id) on delete cascade,
  user_id    uuid references users(id) on delete set null,
  email      text not null,
  status     text not null default 'QUEUED' check (status in ('QUEUED','SENT','FAILED','SKIPPED')),
  error      text,
  attempts   int  not null default 0,
  sent_at    timestamptz,
  updated_at timestamptz not null default app_now(),
  unique (run_id, email)
);

alter table report_email_schedules enable row level security;
alter table report_email_runs enable row level security;
alter table report_email_deliveries enable row level security;
revoke all on report_email_schedules, report_email_runs, report_email_deliveries from anon, authenticated;

-- ---------------------------------------------------------------- organisation-wide aggregates for the summary (service role only)
-- Same sources as read_report_weekly_scores / read_report_quarter_scores (latest snapshot per unit and week; latest quarterly snapshot and
-- the one before it), without the per-person row filter, because the summary is organisation-wide by definition. Business unit level only.
create or replace function email_report_weekly_rows(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.week_start_at, t.business_unit), '[]'::jsonb) from (
    select b.id as business_unit_id, b.code as bu_code, b.name as business_unit,
           w.week_number, w.week_year, w.week_start_at, w.status as week_status, w.reporting_state,
           case when w.reporting_state = 'ORGANIZATION_HOLIDAY' then 'HOLIDAY' when s.id is null then 'PENDING' else s.score_state end as result_state,
           s.final_score, c.status as compliance_status,
           (r.submitted_at is not null and r.submitted_at <= w.content_lock_at) as submitted_before_content_lock
    from reporting_weeks w
    join business_units b on b.status = 'ACTIVE' and b.reports_weekly and b.created_at < w.week_end_at
    left join lateral (select * from weekly_score_snapshots x where x.business_unit_id = b.id and x.reporting_week_id = w.id
                       order by x.version_number desc limit 1) s on true
    left join weekly_compliance c on c.business_unit_id = b.id and c.reporting_week_id = w.id
    left join weekly_reports r on r.business_unit_id = b.id and r.reporting_week_id = w.id
    where (w.week_start_at at time zone 'Africa/Lagos')::date between p_from and p_to
  ) t;
$$;

create or replace function email_report_quarter_rows(p_year int, p_quarter int) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.score desc nulls last, t.business_unit), '[]'::jsonb) from (
    select b.id as business_unit_id, b.name as business_unit, cur.score, cur.denominator_count, prev.score as previous_score
    from quarters q
    join business_units b on b.status = 'ACTIVE' and b.reports_weekly
    left join lateral (select * from quarterly_score_snapshots z where z.quarter_id = q.id and z.business_unit_id = b.id
                       order by z.version_number desc limit 1) cur on true
    left join lateral (select id from quarters x where (x.year, x.quarter_number) < (q.year, q.quarter_number)
                       order by x.year desc, x.quarter_number desc limit 1) pq on true
    left join lateral (select * from quarterly_score_snapshots z where z.quarter_id = pq.id and z.business_unit_id = b.id
                       order by z.version_number desc limit 1) prev on true
    where q.year = p_year and q.quarter_number = p_quarter
  ) t;
$$;

-- ---------------------------------------------------------------- schedules
create or replace function save_report_email_schedule(
  p_actor uuid, p_id uuid, p_name text, p_frequency text, p_send_weekday int, p_send_day int, p_send_time text,
  p_recipient_ids uuid[], p_sections text[], p_active boolean
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := p_id; v_old jsonb; v_bad int; v_recips uuid[];
begin
  perform require_permission(p_actor, 'report_email.manage');
  if p_frequency not in ('WEEKLY','MONTHLY','QUARTERLY','ANNUAL') then raise exception 'VALIDATION_ERROR' using detail = 'frequency'; end if;
  v_recips := (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(p_recipient_ids, '{}')) x);
  if cardinality(v_recips) = 0 then raise exception 'VALIDATION_ERROR' using detail = 'choose at least one recipient'; end if;
  select count(*) into v_bad from unnest(v_recips) x where not exists (select 1 from users u where u.id = x and u.status = 'ACTIVE');
  if v_bad > 0 then raise exception 'VALIDATION_ERROR' using detail = 'recipients must be active people with an account'; end if;
  if v_id is null then
    insert into report_email_schedules (name, frequency, send_weekday, send_day, send_time, recipient_ids, sections, is_active, created_by)
      values (btrim(p_name), p_frequency, p_send_weekday, p_send_day, p_send_time::time, v_recips, p_sections, p_active, p_actor) returning id into v_id;
    perform write_audit(p_actor, 'REPORT_EMAIL_SCHEDULE_CREATED', 'report_email_schedule', v_id::text, null,
      jsonb_build_object('name', btrim(p_name), 'frequency', p_frequency, 'recipients', cardinality(v_recips), 'sections', p_sections, 'active', p_active));
  else
    select to_jsonb(s) into v_old from report_email_schedules s where s.id = v_id;
    if v_old is null then raise exception 'NOT_FOUND'; end if;
    update report_email_schedules set name = btrim(p_name), frequency = p_frequency, send_weekday = p_send_weekday, send_day = p_send_day,
      send_time = p_send_time::time, recipient_ids = v_recips, sections = p_sections, is_active = p_active, updated_at = app_now() where id = v_id;
    perform write_audit(p_actor, 'REPORT_EMAIL_SCHEDULE_CHANGED', 'report_email_schedule', v_id::text,
      jsonb_build_object('name', v_old->>'name', 'frequency', v_old->>'frequency', 'recipients', jsonb_array_length(v_old->'recipient_ids'), 'active', v_old->'is_active'),
      jsonb_build_object('name', btrim(p_name), 'frequency', p_frequency, 'recipients', cardinality(v_recips), 'sections', p_sections, 'active', p_active));
  end if;
  return v_id;
end $$;

create or replace function delete_report_email_schedule(p_actor uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text;
begin
  perform require_permission(p_actor, 'report_email.manage');
  delete from report_email_schedules where id = p_id returning name into v_name;
  if v_name is null then raise exception 'NOT_FOUND'; end if;
  perform write_audit(p_actor, 'REPORT_EMAIL_SCHEDULE_DELETED', 'report_email_schedule', p_id::text, jsonb_build_object('name', v_name), null);
end $$;

-- ---------------------------------------------------------------- runs and deliveries
-- Creates the run and one queued delivery per recipient in one step. A second run for the same schedule and period is refused.
create or replace function begin_report_email_run(
  p_actor uuid, p_schedule uuid, p_trigger text, p_period_key text, p_start date, p_end date, p_summary jsonb, p_subject text, p_recipients jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_n int;
begin
  if p_trigger = 'MANUAL' then perform require_permission(p_actor, 'report_email.send'); end if;
  if not exists (select 1 from report_email_schedules where id = p_schedule) then raise exception 'NOT_FOUND'; end if;
  begin
    insert into report_email_runs (schedule_id, period_key, period_start, period_end, trigger, summary, subject, triggered_by)
      values (p_schedule, p_period_key, p_start, p_end, p_trigger, p_summary, p_subject, p_actor) returning id into v_id;
  exception when unique_violation then
    raise exception 'REPORT_EMAIL_ALREADY_SENT';
  end;
  insert into report_email_deliveries (run_id, user_id, email)
    select v_id, (x->>'id')::uuid, x->>'email' from jsonb_array_elements(p_recipients) x on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then update report_email_runs set status = 'EMPTY', completed_at = app_now() where id = v_id; end if;
  perform write_audit(p_actor, case p_trigger when 'MANUAL' then 'REPORT_EMAIL_SENT_MANUALLY' else 'REPORT_EMAIL_RUN_STARTED' end,
    'report_email_run', v_id::text, null, jsonb_build_object('schedule_id', p_schedule, 'period', p_period_key, 'recipients', v_n));
  return v_id;
end $$;

create or replace function mark_report_email_delivery(p_id uuid, p_ok boolean, p_error text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update report_email_deliveries set attempts = attempts + 1, status = case when p_ok then 'SENT' else 'FAILED' end,
    error = case when p_ok then null else left(coalesce(p_error, 'send failed'), 500) end,
    sent_at = case when p_ok then app_now() else sent_at end, updated_at = app_now() where id = p_id;
end $$;

-- Works out the run's outcome from its deliveries.
create or replace function finish_report_email_run(p_run uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total int; v_sent int; v_status text;
begin
  select count(*), count(*) filter (where status = 'SENT') into v_total, v_sent from report_email_deliveries where run_id = p_run;
  v_status := case when v_total = 0 then 'EMPTY' when v_sent = v_total then 'SENT' when v_sent = 0 then 'FAILED' else 'PARTIAL' end;
  update report_email_runs set status = v_status, completed_at = app_now() where id = p_run;
  return v_status;
end $$;

-- Puts every failed delivery of a run back in the queue. People who already received it are not touched.
create or replace function retry_report_email_run(p_actor uuid, p_run uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  perform require_permission(p_actor, 'report_email.send');
  if not exists (select 1 from report_email_runs where id = p_run) then raise exception 'NOT_FOUND'; end if;
  update report_email_deliveries set status = 'QUEUED', updated_at = app_now() where run_id = p_run and status = 'FAILED';
  get diagnostics v_n = row_count;
  if v_n > 0 then
    update report_email_runs set status = 'PENDING', completed_at = null where id = p_run;
    perform write_audit(p_actor, 'REPORT_EMAIL_RETRIED', 'report_email_run', p_run::text, null, jsonb_build_object('deliveries', v_n));
  end if;
  return v_n;
end $$;

-- A test send and a preview are recorded so there is evidence of who looked at figures and who they were mailed to.
create or replace function record_report_email_test(p_actor uuid, p_schedule uuid, p_kind text, p_period_key text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_permission(p_actor, 'report_email.manage');
  perform write_audit(p_actor, case p_kind when 'TEST' then 'REPORT_EMAIL_TEST_SENT' else 'REPORT_EMAIL_PREVIEWED' end,
    'report_email_schedule', coalesce(p_schedule::text, 'unsaved'), null, jsonb_build_object('period', p_period_key));
end $$;

select lock_down_function_grants();
