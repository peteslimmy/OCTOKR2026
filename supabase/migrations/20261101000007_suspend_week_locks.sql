-- A Super Admin can suspend a week's content lock and final lock so reports can be created or completed by hand, and restore them later.
-- While suspended, the week behaves as OPEN, the scheduled jobs leave it alone and it cannot be finalised. Restoring puts the clock back in charge:
-- if the lock times have passed, the next job run locks and finalises the week as usual. A week that is already final-locked cannot be reopened.
alter table reporting_weeks
  add column locks_suspended_at timestamptz,
  add column locks_suspended_by uuid references users(id),
  add column locks_suspended_reason text,
  add constraint reporting_weeks_suspension_complete check ((locks_suspended_at is null) = (locks_suspended_by is null));

insert into permissions (code, description) values ('reporting.locks.suspend', 'Suspend and restore the content lock and final lock of a reporting week');
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p where r.code = 'SUPER_ADMIN' and p.code = 'reporting.locks.suspend';

create or replace function report_phase(p_week_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when w.status = 'FINAL_LOCKED' then 'FINAL_LOCKED'
    when w.locks_suspended_at is not null then 'OPEN'
    when app_now() >= w.final_lock_at then 'FINAL_LOCKED'
    when app_now() >= w.content_lock_at then 'CONTENT_LOCKED'
    when app_now() >= w.week_start_at then 'OPEN'
    else 'NOT_OPEN' end
  from reporting_weeks w where w.id = p_week_id;
$$;

create or replace function read_active_weeks() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(w) || jsonb_build_object('phase', report_phase(w.id)) order by w.week_start_at desc), '[]'::jsonb)
  from reporting_weeks w
  where (w.week_start_at <= app_now() and w.final_lock_at > app_now() and w.status <> 'FINAL_LOCKED') or (w.locks_suspended_at is not null and w.status <> 'FINAL_LOCKED');
$$;

create or replace function set_week_locks_suspended(p_actor uuid, p_week_id uuid, p_suspend boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare w reporting_weeks; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform require_permission(p_actor, 'reporting.locks.suspend');
  if p_suspend is null then raise exception 'VALIDATION_ERROR' using detail = 'say whether to suspend or restore'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  if char_length(v_reason) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'the reason is limited to 2000 characters'; end if;
  select * into w from reporting_weeks where id = p_week_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if w.status = 'FINAL_LOCKED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'a final-locked week is a closed record and cannot be reopened'; end if;
  if p_suspend then
    if w.locks_suspended_at is not null then return jsonb_build_object('replayed', true, 'suspended', true); end if;
    update reporting_weeks set locks_suspended_at = app_now(), locks_suspended_by = p_actor, locks_suspended_reason = v_reason where id = p_week_id;
    -- reports the clock had already content-locked become editable again
    update weekly_reports set status = 'OPEN', content_locked_at = null, updated_at = app_now() where reporting_week_id = p_week_id and status = 'CONTENT_LOCKED';
    perform write_audit(p_actor, 'REPORTING_WEEK_LOCKS_SUSPENDED', 'reporting_week', p_week_id::text, jsonb_build_object('suspended', false), jsonb_build_object('suspended', true), v_reason, null);
  else
    if w.locks_suspended_at is null then return jsonb_build_object('replayed', true, 'suspended', false); end if;
    update reporting_weeks set locks_suspended_at = null, locks_suspended_by = null, locks_suspended_reason = null where id = p_week_id;
    perform write_audit(p_actor, 'REPORTING_WEEK_LOCKS_RESTORED', 'reporting_week', p_week_id::text, jsonb_build_object('suspended', true), jsonb_build_object('suspended', false), v_reason, null);
  end if;
  return jsonb_build_object('replayed', false, 'suspended', p_suspend);
end $$;

-- the jobs never lock or finalise a suspended week, and finalisation refuses one
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('run_scheduled_jobs()'::regprocedure);
  if position('where status <> ''FINAL_LOCKED'' and app_now() >= content_lock_at loop' in v_def) = 0
     or position('where status <> ''FINAL_LOCKED'' and app_now() >= final_lock_at order by' in v_def) = 0 then raise exception 'run_scheduled_jobs no longer contains the expected lines'; end if;
  v_def := replace(v_def, 'where status <> ''FINAL_LOCKED'' and app_now() >= content_lock_at loop', 'where status <> ''FINAL_LOCKED'' and locks_suspended_at is null and app_now() >= content_lock_at loop');
  v_def := replace(v_def, 'where status <> ''FINAL_LOCKED'' and app_now() >= final_lock_at order by', 'where status <> ''FINAL_LOCKED'' and locks_suspended_at is null and app_now() >= final_lock_at order by');
  execute v_def;
  v_def := pg_get_functiondef('finalize_reporting_week(uuid)'::regprocedure);
  if position('if app_now() < w.final_lock_at then raise exception ''FINAL_LOCK_NOT_DUE''; end if;' in v_def) = 0 then raise exception 'finalize_reporting_week no longer contains the expected line'; end if;
  execute replace(v_def, 'if app_now() < w.final_lock_at then raise exception ''FINAL_LOCK_NOT_DUE''; end if;',
    'if app_now() < w.final_lock_at or w.locks_suspended_at is not null then raise exception ''FINAL_LOCK_NOT_DUE''; end if;');
end $$;

select lock_down_function_grants();
