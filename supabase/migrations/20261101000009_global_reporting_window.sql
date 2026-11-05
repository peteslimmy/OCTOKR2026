-- The reporting window is a global, versioned policy: when reporting OPENS, when goals and tasks LOCK and when the week is FINALISED.
-- It already held the two locks; it now holds the opening moment too. A new version applies to weeks generated afterwards, and an authorised person can
-- also re-apply the current policy to the weeks that have not final-locked yet. A week can still be given its own exceptional times (earlier migrations).

alter table reporting_schedule_versions
  add column open_dow smallint not null default 1 check (open_dow between 1 and 7),
  add column open_time time not null default '00:00',
  add column open_week_offset smallint not null default 0 check (open_week_offset between -1 and 3);   -- weeks after the week's Monday; -1 = in the week before

create or replace function schedule_opens(s reporting_schedule_versions, p_monday date) returns timestamptz
language sql stable as $$
  select ((p_monday + (s.open_dow - 1) + 7 * s.open_week_offset)::timestamp + s.open_time) at time zone 'Africa/Lagos';
$$;

alter table reporting_weeks add column opens_at timestamptz;
update reporting_weeks set opens_at = week_start_at;
alter table reporting_weeks alter column opens_at set not null;

create or replace function ensure_reporting_week(p_date date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_monday date := date_trunc('week', p_date::timestamp)::date;
  v_start timestamptz := v_monday::timestamp at time zone 'Africa/Lagos';
  v_id uuid; v_q uuid; v_org uuid; v_s reporting_schedule_versions;
begin
  select id into v_id from reporting_weeks where week_start_at = v_start;
  if v_id is not null then return v_id; end if;
  select id into v_org from organisations limit 1;
  select id into v_q from quarters where starts_on <= v_monday and ends_on >= v_monday and organisation_id = v_org;
  if v_q is null then raise exception 'QUARTER_NOT_FOUND' using detail = 'No quarter covers ' || v_monday; end if;
  v_s := active_schedule();
  insert into reporting_weeks (organisation_id, quarter_id, week_year, week_number, week_start_at, week_end_at, opens_at, content_lock_at, final_lock_at, schedule_version_id)
  values (v_org, v_q, extract(isoyear from v_monday)::int, extract(week from v_monday)::int, v_start,
          (v_monday + 7)::timestamp at time zone 'Africa/Lagos', schedule_opens(v_s, v_monday), schedule_content_lock(v_s, v_monday), schedule_final_lock(v_s, v_monday), v_s.id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function guard_reporting_week() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD'; end if;
  if new.quarter_id <> old.quarter_id or new.week_start_at <> old.week_start_at then
    raise exception 'IMMUTABLE_RECORD' using detail = 'reporting week schedule is immutable';
  end if;
  -- the opening and the two locks change only when the current policy is re-applied (apply_schedule_to_existing_weeks)
  if (new.content_lock_at <> old.content_lock_at or new.final_lock_at <> old.final_lock_at or new.opens_at <> old.opens_at or new.schedule_version_id <> old.schedule_version_id)
     and coalesce(current_setting('app.schedule_reapply', true), '') <> 'on' then
    raise exception 'IMMUTABLE_RECORD' using detail = 'reporting week schedule is immutable';
  end if;
  if new.reporting_state <> old.reporting_state and coalesce(current_setting('app.holiday_declaration', true), '') <> 'on' then
    raise exception 'PERMISSION_DENIED' using detail = 'reporting_state may only change through the holiday operation';
  end if;
  return new;
end $$;

create or replace function report_phase(p_week_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when w.status = 'FINAL_LOCKED' then 'FINAL_LOCKED'
    when w.locks_suspended_at is not null then 'OPEN'
    when app_now() >= w.final_lock_at then 'FINAL_LOCKED'
    when app_now() >= w.content_lock_at then 'CONTENT_LOCKED'
    when app_now() >= coalesce(w.opens_at_override, w.opens_at) then 'OPEN'
    else 'NOT_OPEN' end
  from reporting_weeks w where w.id = p_week_id;
$$;

create or replace function read_active_weeks() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(w) || jsonb_build_object('phase', report_phase(w.id)) order by w.week_start_at desc), '[]'::jsonb)
  from reporting_weeks w
  where (coalesce(w.opens_at_override, w.opens_at) <= app_now() and w.final_lock_at > app_now() and w.status <> 'FINAL_LOCKED')
     or (w.locks_suspended_at is not null and w.status <> 'FINAL_LOCKED');
$$;

do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('set_week_opening(uuid,uuid,timestamptz,text)'::regprocedure);
  v_def := replace(replace(v_def, 'coalesce(w.opens_at_override, w.week_start_at)', 'coalesce(w.opens_at_override, w.opens_at)'), 'coalesce(p_opens_at, w.week_start_at)', 'coalesce(p_opens_at, w.opens_at)');
  execute v_def;
  v_def := pg_get_functiondef('config_current_value(text,text)'::regprocedure);
  if position('''finalLockWeekOffset'', s.final_lock_week_offset,' in v_def) = 0 then raise exception 'config_current_value no longer contains the expected line'; end if;
  execute replace(v_def, '''finalLockWeekOffset'', s.final_lock_week_offset,',
    '''finalLockWeekOffset'', s.final_lock_week_offset, ''openDay'', s.open_dow, ''openTime'', to_char(s.open_time, ''HH24:MI''), ''openWeekOffset'', s.open_week_offset,');
end $$;

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
    -- the opening moment is optional in a request: when it is left out, the one in force stays
    n.open_dow := coalesce((p->>'openDay')::smallint, cur.open_dow); n.open_time := coalesce((p->>'openTime')::time, cur.open_time); n.open_week_offset := coalesce((p->>'openWeekOffset')::smallint, cur.open_week_offset);
  exception when others then raise exception 'VALIDATION_ERROR' using detail = 'give each moment a weekday (1 to 7), a time (HH:MM) and a week offset';
  end;
  if n.content_lock_dow is null or n.content_lock_time is null or n.content_lock_week_offset is null or n.final_lock_dow is null or n.final_lock_time is null or n.final_lock_week_offset is null
     or n.content_lock_dow not between 1 and 7 or n.final_lock_dow not between 1 and 7 or n.content_lock_week_offset not between 0 and 3 or n.final_lock_week_offset not between 0 and 3
     or n.open_dow not between 1 and 7 or n.open_week_offset not between -1 and 3 then
    raise exception 'VALIDATION_ERROR' using detail = 'give both locks a weekday (1 to 7), a time (HH:MM) and a week offset (0 to 3); reporting may open from the week before (-1) to three weeks after';
  end if;
  if schedule_content_lock(n, v_probe) < (v_probe::timestamp at time zone 'Africa/Lagos') + interval '1 hour' then
    raise exception 'VALIDATION_ERROR' using detail = 'the content lock must fall at least an hour after the week starts (Monday 00:00)';
  end if;
  if schedule_opens(n, v_probe) > schedule_content_lock(n, v_probe) - interval '1 hour' then
    raise exception 'VALIDATION_ERROR' using detail = 'reporting must open at least an hour before the content lock';
  end if;
  if schedule_final_lock(n, v_probe) < schedule_content_lock(n, v_probe) + interval '1 hour' then
    raise exception 'VALIDATION_ERROR' using detail = 'the final lock must come at least an hour after the content lock';
  end if;
  if schedule_final_lock(n, v_probe) > (v_probe::timestamp at time zone 'Africa/Lagos') + interval '35 days' then
    raise exception 'VALIDATION_ERROR' using detail = 'the final lock cannot be more than five weeks after the week starts';
  end if;
  if n.content_lock_dow = cur.content_lock_dow and n.content_lock_time = cur.content_lock_time and n.content_lock_week_offset = cur.content_lock_week_offset
     and n.final_lock_dow = cur.final_lock_dow and n.final_lock_time = cur.final_lock_time and n.final_lock_week_offset = cur.final_lock_week_offset
     and n.open_dow = cur.open_dow and n.open_time = cur.open_time and n.open_week_offset = cur.open_week_offset then
    raise exception 'VALIDATION_ERROR' using detail = 'these are the times already in force';
  end if;
  insert into reporting_schedule_versions (version, content_lock_dow, content_lock_time, content_lock_week_offset, final_lock_dow, final_lock_time, final_lock_week_offset,
                                           open_dow, open_time, open_week_offset, reason, created_by, change_request_id)
    values (cur.version + 1, n.content_lock_dow, n.content_lock_time, n.content_lock_week_offset, n.final_lock_dow, n.final_lock_time, n.final_lock_week_offset,
            n.open_dow, n.open_time, n.open_week_offset, r.reason, r.requested_by, (select id from config_change_requests where id = r.id))
    returning id into v_id;
  v_first := schedule_first_affected_week();
  perform write_audit(r.requested_by, 'LOCK_SCHEDULE_CHANGED', 'reporting_schedule', v_id::text,
    jsonb_build_object('version', cur.version, 'open', jsonb_build_array(cur.open_dow, cur.open_time, cur.open_week_offset), 'content_lock', jsonb_build_array(cur.content_lock_dow, cur.content_lock_time, cur.content_lock_week_offset), 'final_lock', jsonb_build_array(cur.final_lock_dow, cur.final_lock_time, cur.final_lock_week_offset)),
    jsonb_build_object('version', cur.version + 1, 'open', jsonb_build_array(n.open_dow, n.open_time, n.open_week_offset), 'content_lock', jsonb_build_array(n.content_lock_dow, n.content_lock_time, n.content_lock_week_offset), 'final_lock', jsonb_build_array(n.final_lock_dow, n.final_lock_time, n.final_lock_week_offset), 'first_affected_week', v_first), r.reason);
  perform notify_users(array_remove(users_with_permission('weekly_report.submit') || users_with_permission('reporting.week.manage') || users_with_permission('attendance.session.manage'), r.requested_by),
    'LOCK_SCHEDULE_CHANGED', 'reporting_schedule', v_id::text, 'The reporting window will change',
    'New reporting times were approved. They apply to weeks generated from ' || coalesce(to_char(v_first, 'DD Mon YYYY'), 'the next quarter you activate') || ' onward, and to existing weeks only if an administrator re-applies them.', 'lock-sched:' || v_id);
end $$;

-- Re-apply the policy in force to every week that has not final-locked yet (its opening, content lock and final lock). Weeks that are suspended,
-- final-locked or past their final lock keep what they have; a week's own exceptional opening time is left as set.
create or replace function apply_schedule_to_existing_weeks(p_actor uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s reporting_schedule_versions := active_schedule(); w record; n int := 0; v_monday date; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform require_permission(p_actor, 'reporting.week.manage');
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  perform set_config('app.schedule_reapply', 'on', true);
  for w in select id, week_start_at from reporting_weeks where status <> 'FINAL_LOCKED' and locks_suspended_at is null and final_lock_at > app_now() and schedule_version_id <> s.id for update loop
    v_monday := (w.week_start_at at time zone 'Africa/Lagos')::date;
    update reporting_weeks set opens_at = schedule_opens(s, v_monday), content_lock_at = schedule_content_lock(s, v_monday), final_lock_at = schedule_final_lock(s, v_monday), schedule_version_id = s.id
     where id = w.id;
    n := n + 1;
  end loop;
  perform set_config('app.schedule_reapply', 'off', true);
  perform write_audit(p_actor, 'REPORTING_SCHEDULE_REAPPLIED', 'reporting_schedule', s.id::text, null, jsonb_build_object('version', s.version, 'weeks_updated', n), v_reason, null);
  return jsonb_build_object('version', s.version, 'weeks_updated', n);
end $$;

create or replace function read_lock_schedule() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'active', (select to_jsonb(s) from reporting_schedule_versions s order by version desc limit 1),
    'history', coalesce((select jsonb_agg(to_jsonb(s) order by s.version desc) from reporting_schedule_versions s), '[]'::jsonb),
    'first_affected_week', (select min(q.starts_on) from quarters q where not exists (select 1 from reporting_weeks w where w.quarter_id = q.id)),
    'weeks_by_version', coalesce((select jsonb_object_agg(v.version, v.n) from (select s.version, count(w.id) n from reporting_schedule_versions s left join reporting_weeks w on w.schedule_version_id = s.id group by s.version) v), '{}'::jsonb),
    'weeks_reapplicable', (select count(*) from reporting_weeks w where w.status <> 'FINAL_LOCKED' and w.locks_suspended_at is null and w.final_lock_at > app_now()
                             and w.schedule_version_id <> (select id from reporting_schedule_versions order by version desc limit 1)));
$$;
select lock_down_function_grants();
