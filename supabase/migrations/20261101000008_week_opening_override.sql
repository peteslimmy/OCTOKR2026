-- When reporting opens is normally the start of the week (Monday 00:00 WAT). A week can be given its own opening time, earlier or later,
-- and put back to the default. The week's start itself, its content lock and its final lock keep their own rules.
alter table reporting_weeks
  add column opens_at_override timestamptz,
  add column opens_override_by uuid references users(id),
  add column opens_override_reason text,
  add constraint reporting_weeks_opens_override_complete check ((opens_at_override is null) = (opens_override_by is null));

create or replace function report_phase(p_week_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when w.status = 'FINAL_LOCKED' then 'FINAL_LOCKED'
    when w.locks_suspended_at is not null then 'OPEN'
    when app_now() >= w.final_lock_at then 'FINAL_LOCKED'
    when app_now() >= w.content_lock_at then 'CONTENT_LOCKED'
    when app_now() >= coalesce(w.opens_at_override, w.week_start_at) then 'OPEN'
    else 'NOT_OPEN' end
  from reporting_weeks w where w.id = p_week_id;
$$;

create or replace function read_active_weeks() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(w) || jsonb_build_object('phase', report_phase(w.id)) order by w.week_start_at desc), '[]'::jsonb)
  from reporting_weeks w
  where (coalesce(w.opens_at_override, w.week_start_at) <= app_now() and w.final_lock_at > app_now() and w.status <> 'FINAL_LOCKED')
     or (w.locks_suspended_at is not null and w.status <> 'FINAL_LOCKED');
$$;

-- p_opens_at null puts the week back on its default opening time
create or replace function set_week_opening(p_actor uuid, p_week_id uuid, p_opens_at timestamptz, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare w reporting_weeks; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform require_permission(p_actor, 'reporting.week.manage');
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  if char_length(v_reason) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'the reason is limited to 2000 characters'; end if;
  select * into w from reporting_weeks where id = p_week_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if w.status = 'FINAL_LOCKED' or app_now() >= w.final_lock_at then raise exception 'INVALID_STATE_TRANSITION' using detail = 'a week that has final-locked cannot change when it opens'; end if;
  if p_opens_at is not null and p_opens_at >= w.content_lock_at then raise exception 'VALIDATION_ERROR' using detail = 'reporting must open before the content lock'; end if;
  if p_opens_at is null then
    update reporting_weeks set opens_at_override = null, opens_override_by = null, opens_override_reason = null where id = p_week_id;
  else
    update reporting_weeks set opens_at_override = p_opens_at, opens_override_by = p_actor, opens_override_reason = v_reason where id = p_week_id;
  end if;
  perform write_audit(p_actor, case when p_opens_at is null then 'REPORTING_WEEK_OPENING_RESET' else 'REPORTING_WEEK_OPENING_SET' end, 'reporting_week', p_week_id::text,
    jsonb_build_object('opens_at', coalesce(w.opens_at_override, w.week_start_at)), jsonb_build_object('opens_at', coalesce(p_opens_at, w.week_start_at)), v_reason, null);
  return jsonb_build_object('opens_at', coalesce(p_opens_at, w.week_start_at), 'overridden', p_opens_at is not null);
end $$;
select lock_down_function_grants();
