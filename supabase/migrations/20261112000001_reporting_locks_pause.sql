-- Organisation-wide Off/On switch for the content locks (owner request 24 November 2026, ADR in docs/24-DECISIONS.md).
--
-- OFF ("paused") holds every week that is open now, and every week as it opens while the pause lasts, in the same state as a single week whose locks a Super Admin
-- has suspended (migration 20261101000007): BU Leads can create and edit goals and tasks, mark tasks and submit, whatever the clock says, and reports the clock had
-- already content-locked become editable again.
--   * It is a pause, not a way around scoring. The owner's rule stands (migration 20261104000014): a week whose FINAL lock time has passed is final. The scheduled job
--     still finalises and scores it, whether or not it is paused.
--   * It is temporary: it may carry a resume time (at most 30 days away), and the scheduled job switches it back on by itself when that time is reached.
--   * Switching ON restores exactly the weeks the pause suspended. A week a Super Admin suspended individually before or during the pause stays as it was.
--   * Every change is audited with its reason; only a Super Admin may switch it (permission reporting.locks.suspend, already held by the Super Admin).
-- The per-week machinery (report_phase, the jobs, finalisation, status changes) is reused unchanged, so no existing rule is re-implemented.

create table reporting_lock_pause (
  id          boolean primary key default true check (id),                    -- one row
  paused      boolean not null default false,
  paused_at   timestamptz,
  paused_by   uuid references users(id),
  reason      text,
  resume_at   timestamptz,
  changed_at  timestamptz not null default app_now(),
  constraint reporting_lock_pause_complete check (not paused or (paused_at is not null and paused_by is not null and reason is not null))
);
insert into reporting_lock_pause (id, paused) values (true, false);
alter table reporting_lock_pause enable row level security;
grant select on reporting_lock_pause to authenticated;
create policy read_managers on reporting_lock_pause for select to authenticated
  using ((select auth_has_permission('reporting.week.manage')) or (select auth_has_permission('reporting.locks.suspend')));    -- everyone else reads read_lock_pause(), which hides the reason

alter table reporting_weeks add column locks_paused_by_org boolean not null default false;     -- this week's suspension came from the organisation-wide pause

-- ------------------------------------------------------------------ hold open every week that is open now (and not yet final)
create or replace function lock_pause_extend(p_actor uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare p reporting_lock_pause; w record; v_n int := 0; v_actor uuid; v_reason text;
begin
  select * into p from reporting_lock_pause where id;
  if not p.paused then return 0; end if;
  v_actor := coalesce(p_actor, p.paused_by);
  v_reason := 'Organisation-wide pause: ' || p.reason;
  for w in select id from reporting_weeks
            where status <> 'FINAL_LOCKED' and locks_suspended_at is null and final_lock_at > app_now() and coalesce(opens_at_override, opens_at) <= app_now()
            order by week_start_at for update loop
    update reporting_weeks set locks_suspended_at = app_now(), locks_suspended_by = v_actor, locks_suspended_reason = v_reason, locks_paused_by_org = true where id = w.id;
    -- reports the clock had already content-locked become editable again (as for a single week)
    update weekly_reports set status = 'OPEN', content_locked_at = null, updated_at = app_now() where reporting_week_id = w.id and status = 'CONTENT_LOCKED';
    perform write_audit(p_actor, 'REPORTING_WEEK_LOCKS_SUSPENDED', 'reporting_week', w.id::text, jsonb_build_object('suspended', false), jsonb_build_object('suspended', true, 'by', 'organisation pause'), v_reason, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ------------------------------------------------------------------ give the weeks back to the clock
create or replace function lock_pause_resume(p_actor uuid, p_reason text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare w record; v_n int := 0;
begin
  for w in select id from reporting_weeks where locks_paused_by_org and locks_suspended_at is not null and status <> 'FINAL_LOCKED' order by week_start_at for update loop
    update reporting_weeks set locks_suspended_at = null, locks_suspended_by = null, locks_suspended_reason = null, locks_paused_by_org = false where id = w.id;
    perform write_audit(p_actor, 'REPORTING_WEEK_LOCKS_RESTORED', 'reporting_week', w.id::text, jsonb_build_object('suspended', true), jsonb_build_object('suspended', false, 'by', 'organisation pause'), p_reason, null);
    v_n := v_n + 1;
  end loop;
  return v_n;                                                                       -- a week finalised while paused keeps its record untouched: final weeks are never edited
end $$;

-- ------------------------------------------------------------------ the switch
create or replace function set_reporting_locks_paused(p_actor uuid, p_paused boolean, p_reason text, p_resume_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p reporting_lock_pause; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_n int;
begin
  perform require_permission(p_actor, 'reporting.locks.suspend');
  if p_paused is null then raise exception 'VALIDATION_ERROR' using detail = 'say whether to pause or switch the locks back on'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  if char_length(v_reason) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'the reason is limited to 2000 characters'; end if;
  select * into p from reporting_lock_pause where id for update;

  if p_paused then
    if p_resume_at is not null and (p_resume_at <= app_now() or p_resume_at > app_now() + interval '30 days') then
      raise exception 'VALIDATION_ERROR' using detail = 'the locks must switch back on within the next 30 days; choose a later time than now, or leave it empty to switch them on yourself';
    end if;
    if p.paused then return jsonb_build_object('replayed', true, 'paused', true, 'resume_at', p.resume_at); end if;
    update reporting_lock_pause set paused = true, paused_at = app_now(), paused_by = p_actor, reason = v_reason, resume_at = p_resume_at, changed_at = app_now() where id;
    v_n := lock_pause_extend(p_actor);
    perform write_audit(p_actor, 'REPORTING_LOCKS_PAUSED', 'organisation', 'reporting-locks', jsonb_build_object('paused', false),
      jsonb_build_object('paused', true, 'resume_at', p_resume_at, 'weeks_held_open', v_n), v_reason, null);
    return jsonb_build_object('replayed', false, 'paused', true, 'resume_at', p_resume_at, 'weeks_held_open', v_n);
  end if;

  if not p.paused then return jsonb_build_object('replayed', true, 'paused', false); end if;
  update reporting_lock_pause set paused = false, paused_at = null, paused_by = null, reason = null, resume_at = null, changed_at = app_now() where id;
  v_n := lock_pause_resume(p_actor, v_reason);
  perform write_audit(p_actor, 'REPORTING_LOCKS_RESUMED', 'organisation', 'reporting-locks', jsonb_build_object('paused', true, 'since', p.paused_at, 'reason', p.reason),
    jsonb_build_object('paused', false, 'weeks_restored', v_n), v_reason, null);
  return jsonb_build_object('replayed', false, 'paused', false, 'weeks_restored', v_n);
end $$;

-- ------------------------------------------------------------------ the scheduled job's share: switch back on at the resume time, and hold open weeks that opened during the pause
create or replace function lock_pause_tick() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p reporting_lock_pause; v_n int;
begin
  select * into p from reporting_lock_pause where id;
  if not p.paused then return; end if;
  if p.resume_at is not null and p.resume_at <= app_now() then
    update reporting_lock_pause set paused = false, paused_at = null, paused_by = null, reason = null, resume_at = null, changed_at = app_now() where id;
    v_n := lock_pause_resume(null, 'The resume time was reached');
    perform write_audit(null, 'REPORTING_LOCKS_RESUMED', 'organisation', 'reporting-locks', jsonb_build_object('paused', true, 'since', p.paused_at, 'reason', p.reason),
      jsonb_build_object('paused', false, 'weeks_restored', v_n, 'automatic', true), 'The resume time was reached', null);
  else
    perform lock_pause_extend(null);
  end if;
end $$;

do $$
declare v_def text; a constant text := 'for w in select id from quarters where status = ''ACTIVE'' loop perform ensure_quarter_weeks(w.id); end loop;';
  v_n int;
begin
  v_def := pg_get_functiondef('run_scheduled_jobs()'::regprocedure);
  v_n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
  if v_n <> 1 then raise exception 'run_scheduled_jobs: expected the quarter-weeks line once, found % times', v_n; end if;
  -- before the lock processing: a pause that has run out is lifted first, and weeks that opened meanwhile are held open
  execute replace(v_def, a, a || '
  begin perform lock_pause_tick();
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform write_audit(null, ''JOB_FAILED'', ''job'', ''lock_pause_tick'', null, jsonb_build_object(''error'', v_err), null, null, ''FAILURE'');
  end;');
end $$;

-- ------------------------------------------------------------------ what everyone may see, and what only managers may see
create or replace function read_lock_pause() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'paused', p.paused, 'paused_at', p.paused_at, 'resume_at', p.resume_at,
    'reason', case when (select auth_has_permission('reporting.week.manage')) or (select auth_has_permission('reporting.locks.suspend')) then p.reason end,
    'paused_by_email', case when (select auth_has_permission('reporting.week.manage')) or (select auth_has_permission('reporting.locks.suspend')) then (select u.email from users u where u.id = p.paused_by) end,
    'weeks_held_open', (select count(*) from reporting_weeks w where w.locks_paused_by_org and w.locks_suspended_at is not null and w.status <> 'FINAL_LOCKED'))
  from reporting_lock_pause p where p.id;
$$;

select lock_down_function_grants();
