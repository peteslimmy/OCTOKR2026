-- Configurable lock schedule (ADR-070, docs/30 E-02).
-- The content-lock and final-lock moments used to be literals inside ensure_reporting_week(). They are now an immutable, versioned setting, changed
-- through an approved configuration change (ADR-068). Owner rule: a change can never apply to a week that has already been generated.
-- A week stores its lock times when it is generated (as before) plus the schedule version it was generated under, so every week keeps the rule it ran
-- under. A new version therefore applies only to weeks generated AFTER it was approved. A quarter's weeks are all generated when it is activated (the
-- quarterly denominator and every report that walks the quarter depend on the complete calendar), so in practice a change takes effect from the next
-- quarter to be activated, and the screen says which week that is.
--
-- Not configurable on purpose: the time zone (Africa/Lagos) and Monday as the first day of the week. Changing either would leave a gap or an overlap
-- between consecutive weeks.

create table reporting_schedule_versions (
  id                      uuid primary key default gen_random_uuid(),
  version                 int not null unique,
  content_lock_dow        smallint not null check (content_lock_dow between 1 and 7),          -- ISO weekday: 1 Monday ... 7 Sunday
  content_lock_time       time not null,
  content_lock_week_offset smallint not null check (content_lock_week_offset between 0 and 3),   -- weeks after the week's Monday
  final_lock_dow          smallint not null check (final_lock_dow between 1 and 7),
  final_lock_time         time not null,
  final_lock_week_offset  smallint not null check (final_lock_week_offset between 0 and 3),
  reason                  text,
  created_by              uuid references users(id),
  change_request_id       uuid references config_change_requests(id),
  created_at              timestamptz not null default app_now()
);
create trigger reporting_schedule_versions_immutable before update or delete on reporting_schedule_versions
  for each row execute function forbid_mutation();
alter table reporting_schedule_versions enable row level security;
grant select on reporting_schedule_versions to authenticated;
create policy read_all on reporting_schedule_versions for select to authenticated using (true);

-- version 1 is exactly what the code did before: content lock Tuesday 18:00 of the opening week, final lock Tuesday 11:00 of the following week
insert into reporting_schedule_versions (version, content_lock_dow, content_lock_time, content_lock_week_offset, final_lock_dow, final_lock_time, final_lock_week_offset, reason)
values (1, 2, '18:00', 0, 2, '11:00', 1, 'The schedule in force before it became configurable');

alter table reporting_weeks add column schedule_version_id uuid references reporting_schedule_versions(id);
update reporting_weeks set schedule_version_id = (select id from reporting_schedule_versions where version = 1);
alter table reporting_weeks alter column schedule_version_id set not null;

create or replace function active_schedule() returns reporting_schedule_versions
language sql stable security definer set search_path = public, pg_temp as $$
  select s from reporting_schedule_versions s order by version desc limit 1;
$$;

-- the two lock moments of the week that starts on p_monday under schedule s (time zone and week start are fixed)
create or replace function schedule_content_lock(s reporting_schedule_versions, p_monday date) returns timestamptz
language sql stable as $$
  select ((p_monday + (s.content_lock_dow - 1) + 7 * s.content_lock_week_offset)::timestamp + s.content_lock_time) at time zone 'Africa/Lagos';
$$;
create or replace function schedule_final_lock(s reporting_schedule_versions, p_monday date) returns timestamptz
language sql stable as $$
  select ((p_monday + (s.final_lock_dow - 1) + 7 * s.final_lock_week_offset)::timestamp + s.final_lock_time) at time zone 'Africa/Lagos';
$$;

create or replace function ensure_reporting_week(p_date date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_monday date := date_trunc('week', p_date::timestamp)::date;
  v_start timestamptz := v_monday::timestamp at time zone 'Africa/Lagos';
  v_id uuid; v_q uuid; v_org uuid; v_s reporting_schedule_versions;
begin
  select id into v_id from reporting_weeks where week_start_at = v_start;
  if v_id is not null then return v_id; end if;                       -- a generated week is never regenerated or changed
  select id into v_org from organisations limit 1;
  select id into v_q from quarters where starts_on <= v_monday and ends_on >= v_monday and organisation_id = v_org;
  if v_q is null then raise exception 'QUARTER_NOT_FOUND' using detail = 'No quarter covers ' || v_monday; end if;
  v_s := active_schedule();
  insert into reporting_weeks (organisation_id, quarter_id, week_year, week_number, week_start_at, week_end_at, content_lock_at, final_lock_at, schedule_version_id)
  values (v_org, v_q, extract(isoyear from v_monday)::int, extract(week from v_monday)::int, v_start,
          (v_monday + 7)::timestamp at time zone 'Africa/Lagos', schedule_content_lock(v_s, v_monday), schedule_final_lock(v_s, v_monday), v_s.id)
  returning id into v_id;
  return v_id;
end $$;

-- the first week that will be generated under a new schedule: the start of the first quarter that has no weeks yet
create or replace function schedule_first_affected_week() returns date
language sql stable security definer set search_path = public, pg_temp as $$
  select min(q.starts_on) from quarters q where not exists (select 1 from reporting_weeks w where w.quarter_id = q.id);
$$;

insert into config_change_topics (code, description, request_permission, approve_permission, protected)
values ('LOCK_SCHEDULE', 'Change when reports lock and finalise (applies only to weeks not yet generated)', 'reporting.week.manage', 'config.approve', false);

create or replace function apply_lock_schedule(r config_change_requests) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p jsonb := r.proposed; cur reporting_schedule_versions := active_schedule(); n reporting_schedule_versions; v_id uuid;
  v_probe date := date '2030-01-07';                                   -- any Monday: only the relative offsets matter
  v_first date;
begin
  perform require_permission(r.requested_by, 'reporting.week.manage');
  begin
    n.content_lock_dow := (p->>'contentLockDay')::smallint; n.content_lock_time := (p->>'contentLockTime')::time; n.content_lock_week_offset := (p->>'contentLockWeekOffset')::smallint;
    n.final_lock_dow := (p->>'finalLockDay')::smallint; n.final_lock_time := (p->>'finalLockTime')::time; n.final_lock_week_offset := (p->>'finalLockWeekOffset')::smallint;
  exception when others then raise exception 'VALIDATION_ERROR' using detail = 'give both locks a weekday (1 to 7), a time (HH:MM) and a week offset (0 to 3)';
  end;
  if n.content_lock_dow is null or n.content_lock_time is null or n.content_lock_week_offset is null or n.final_lock_dow is null or n.final_lock_time is null or n.final_lock_week_offset is null
     or n.content_lock_dow not between 1 and 7 or n.final_lock_dow not between 1 and 7 or n.content_lock_week_offset not between 0 and 3 or n.final_lock_week_offset not between 0 and 3 then
    raise exception 'VALIDATION_ERROR' using detail = 'give both locks a weekday (1 to 7), a time (HH:MM) and a week offset (0 to 3)';
  end if;
  if schedule_content_lock(n, v_probe) < (v_probe::timestamp at time zone 'Africa/Lagos') + interval '1 hour' then
    raise exception 'VALIDATION_ERROR' using detail = 'the content lock must fall at least an hour after the week starts (Monday 00:00)';
  end if;
  if schedule_final_lock(n, v_probe) < schedule_content_lock(n, v_probe) + interval '1 hour' then
    raise exception 'VALIDATION_ERROR' using detail = 'the final lock must come at least an hour after the content lock';
  end if;
  if schedule_final_lock(n, v_probe) > (v_probe::timestamp at time zone 'Africa/Lagos') + interval '35 days' then
    raise exception 'VALIDATION_ERROR' using detail = 'the final lock cannot be more than five weeks after the week starts';
  end if;
  if n.content_lock_dow = cur.content_lock_dow and n.content_lock_time = cur.content_lock_time and n.content_lock_week_offset = cur.content_lock_week_offset
     and n.final_lock_dow = cur.final_lock_dow and n.final_lock_time = cur.final_lock_time and n.final_lock_week_offset = cur.final_lock_week_offset then
    raise exception 'VALIDATION_ERROR' using detail = 'these are the lock times already in force';
  end if;
  insert into reporting_schedule_versions (version, content_lock_dow, content_lock_time, content_lock_week_offset, final_lock_dow, final_lock_time, final_lock_week_offset, reason, created_by, change_request_id)
    values (cur.version + 1, n.content_lock_dow, n.content_lock_time, n.content_lock_week_offset, n.final_lock_dow, n.final_lock_time, n.final_lock_week_offset, r.reason, r.requested_by,
            (select id from config_change_requests where id = r.id))
    returning id into v_id;
  v_first := schedule_first_affected_week();
  perform write_audit(r.requested_by, 'LOCK_SCHEDULE_CHANGED', 'reporting_schedule', v_id::text,
    jsonb_build_object('version', cur.version, 'content_lock', jsonb_build_array(cur.content_lock_dow, cur.content_lock_time, cur.content_lock_week_offset), 'final_lock', jsonb_build_array(cur.final_lock_dow, cur.final_lock_time, cur.final_lock_week_offset)),
    jsonb_build_object('version', cur.version + 1, 'content_lock', jsonb_build_array(n.content_lock_dow, n.content_lock_time, n.content_lock_week_offset), 'final_lock', jsonb_build_array(n.final_lock_dow, n.final_lock_time, n.final_lock_week_offset), 'first_affected_week', v_first), r.reason);
  perform notify_users(array_remove(users_with_permission('weekly_report.submit') || users_with_permission('reporting.week.manage') || users_with_permission('attendance.session.manage'), r.requested_by),
    'LOCK_SCHEDULE_CHANGED', 'reporting_schedule', v_id::text, 'Report lock times will change',
    'New lock times were approved. They apply to weeks generated from ' || coalesce(to_char(v_first, 'DD Mon YYYY'), 'the next quarter you activate') || ' onward; weeks already generated keep their lock times.', 'lock-sched:' || v_id);
end $$;

-- the engine's dispatchers learn the new topic (full replacements; ROLE_CHANGE and the four earlier topics are unchanged)
create or replace function config_current_value(p_topic text, p_target text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return case p_topic
    when 'VIOLATION_TYPE'    then (select to_jsonb(v) from violation_types v where p_target is not null and (v.id::text = p_target or v.code = upper(p_target)))
    when 'PENALTY_RATE'      then (select to_jsonb(c) from integrity_penalty_configurations c where c.effective_to is null order by c.created_at desc limit 1)
    when 'REMINDER_SETTINGS' then (select to_jsonb(s) from notification_settings s where s.id)
    when 'BU_REPORTING'      then (select to_jsonb(b) from business_units b where p_target is not null and b.id = p_target::uuid)
    when 'ROLE_CHANGE'       then (select jsonb_build_object('code', r.code, 'name', r.name, 'description', r.description, 'permissions', role_permission_codes(r.id),
                                     'requiresMfa', exists (select 1 from mfa_required_roles m where m.role_id = r.id), 'holders', (select count(*) from user_roles ur where ur.role_id = r.id))
                                   from roles r where p_target is not null and r.id::text = p_target)
    when 'LOCK_SCHEDULE'     then (select jsonb_build_object('contentLockDay', s.content_lock_dow, 'contentLockTime', to_char(s.content_lock_time, 'HH24:MI'), 'contentLockWeekOffset', s.content_lock_week_offset,
                                     'finalLockDay', s.final_lock_dow, 'finalLockTime', to_char(s.final_lock_time, 'HH24:MI'), 'finalLockWeekOffset', s.final_lock_week_offset, 'version', s.version)
                                   from reporting_schedule_versions s order by s.version desc limit 1)
    else null end;
end $$;

create or replace function apply_config_change(r config_change_requests) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p jsonb := r.proposed;
begin
  case r.topic
    when 'VIOLATION_TYPE' then
      if p->>'action' = 'CREATE' then
        perform create_violation_type(r.requested_by, p->>'code', p->>'name', p->>'criticality', (p->>'defaultFine')::numeric);
      elsif p->>'action' = 'UPDATE' and r.target is not null then
        perform update_violation_type(r.requested_by, r.target::uuid, p->>'name', p->>'criticality', (p->>'defaultFine')::numeric, (p->>'active')::boolean);
      else raise exception 'VALIDATION_ERROR' using detail = 'action must be CREATE or UPDATE (with a target)';
      end if;
    when 'PENALTY_RATE' then
      perform set_integrity_penalty_rate(r.requested_by, (p->>'rate')::numeric);
    when 'REMINDER_SETTINGS' then
      perform update_notification_settings(r.requested_by, (p->>'remindersEnabled')::boolean,
        (select array_agg(x::int) from jsonb_array_elements_text(p->'reminderHours') x), (p->>'maxRemindersPerWeek')::int, (p->>'emailEnabled')::boolean);
    when 'BU_REPORTING' then
      if r.target is null then raise exception 'VALIDATION_ERROR' using detail = 'choose the Business Unit'; end if;
      perform update_business_unit(r.requested_by, r.target::uuid, p->>'name', p->>'status', coalesce((p->>'reportsWeekly')::boolean, true));
    when 'ROLE_CHANGE' then
      perform apply_role_change(r);
    when 'LOCK_SCHEDULE' then
      perform apply_lock_schedule(r);
    else raise exception 'VALIDATION_ERROR' using detail = 'unknown configuration topic ' || r.topic;
  end case;
exception when invalid_text_representation or numeric_value_out_of_range or null_value_not_allowed or invalid_parameter_value then
  raise exception 'VALIDATION_ERROR' using detail = 'the proposed values are not valid for this setting';
end $$;

-- words that named the old fixed times now follow the stored lock time
do $$
declare v_def text; v_new text; f record;
begin
  for f in select * from (values
      ('send_report_reminders', 'lock on Tuesday at 18:00 (Lagos time).', 'lock on '' || to_char(w.content_lock_at at time zone ''Africa/Lagos'', ''FMDay "at" HH24:MI'') || '' (Lagos time).'),
      ('execute_task', ' (Tuesday 18:00 WAT)', '')
    ) t(fn, old_text, new_text) loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f.fn;
    v_new := replace(v_def, f.old_text, f.new_text);
    if v_new = v_def then raise exception 'expected text not found in %: %', f.fn, f.old_text; end if;
    execute v_new;
  end loop;
end $$;

create or replace function read_lock_schedule() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'active', (select to_jsonb(s) from reporting_schedule_versions s order by version desc limit 1),
    'history', coalesce((select jsonb_agg(to_jsonb(s) order by s.version desc) from reporting_schedule_versions s), '[]'::jsonb),
    'first_affected_week', (select min(q.starts_on) from quarters q where not exists (select 1 from reporting_weeks w where w.quarter_id = q.id)),
    'weeks_by_version', coalesce((select jsonb_object_agg(v.version, v.n) from (select s.version, count(w.id) n from reporting_schedule_versions s left join reporting_weeks w on w.schedule_version_id = s.id group by s.version) v), '{}'::jsonb));
$$;

select lock_down_function_grants();
