-- 4COREPAL phase 4: monitoring, findings and the per-task remark requests (docs/38-4COREPAL-DESIGN.md sections 4 and 5).
--
-- All of it is deterministic SQL over recorded data: no AI model is involved in deciding who is asked what. It runs from the existing scheduler through one guarded
-- call that does nothing while the module is off, and a failure in it is recorded and can never stop the scheduler's own work.
-- Every step is idempotent: a request is unique per business unit and week, a notification is unique per person and key, a finding is unique by fingerprint.
-- Nothing here changes a task, a score, a report or a locked week.

insert into ai_settings (key, value, kind, label, help) values
  ('remark_lookback_days', '21', 'number', 'How far back remark requests are made (days since the week was finalised)', 'Stops the first run after switching the module on from asking about old history.'),
  ('score_drop_points',    '15', 'number', 'A week''s score falling by this many points or more is flagged', null);

insert into email_event_types (event_type, mandatory, description) values
  ('AI_REMARK_REQUEST',  false, '4COREPAL: remarks are needed on tasks that were not done'),
  ('AI_REMARK_REMINDER', false, '4COREPAL: a reminder that remarks are still needed'),
  ('AI_ESCALATION',      false, '4COREPAL: a request for remarks went unanswered');

-- a stale RUNNING job (the process died) can be taken again after 30 minutes
create or replace function ai_job_begin(p_kind text, p_key text, p_for timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j ai_jobs; v_max int := coalesce((select (value)::text::int from ai_settings where key = 'max_retries'), 2) + 1;
begin
  insert into ai_jobs (kind, idempotency_key, scheduled_for, max_attempts) values (p_kind, p_key, p_for, v_max) on conflict (idempotency_key) do nothing;
  select * into j from ai_jobs where idempotency_key = p_key for update;
  if j.status in ('SUCCEEDED', 'DEAD') or (j.status = 'RUNNING' and j.started_at > clock_timestamp() - interval '30 minutes') then
    return jsonb_build_object('id', j.id, 'run', false, 'status', j.status);
  end if;
  if j.attempts >= j.max_attempts then update ai_jobs set status = 'DEAD', finished_at = clock_timestamp() where id = j.id; return jsonb_build_object('id', j.id, 'run', false, 'status', 'DEAD'); end if;
  update ai_jobs set status = 'RUNNING', attempts = attempts + 1, started_at = clock_timestamp(), error = null where id = j.id;
  return jsonb_build_object('id', j.id, 'run', true, 'status', 'RUNNING');
end $$;

-- ------------------------------------------------------------------ who is asked
-- The people who answer for a unit: active people in it who may give remarks (BU Leads by default). The people executives are: organisation-wide insight and the executive dashboard.
create or replace function ai_remark_recipients(p_bu uuid) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id from users u join employees e on e.id = u.employee_id
   where e.business_unit_id = p_bu and u.status = 'ACTIVE' and actor_has_permission(u.id, 'ai.remark.submit');
$$;
create or replace function ai_executive_recipients() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id from users u where u.status = 'ACTIVE' and actor_has_permission(u.id, 'ai.insights.org') and actor_has_permission(u.id, 'dashboard.executive.view');
$$;

-- ------------------------------------------------------------------ the tasks that need a remark
-- A task is due at the end of its week. It needs a remark when its week is final and it was not done: the week is not an organisation holiday, the unit reports weekly
-- and is active, and the week was finalised within the look-back. A task is never counted twice, and a deleted task is not asked about.
create or replace function ai_unresolved_tasks(p_bu uuid, p_week uuid) returns table (task_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id from tasks t
    join smart_goals g on g.id = t.smart_goal_id and g.deleted_at is null
    join weekly_reports r on r.id = g.weekly_report_id
    join reporting_weeks w on w.id = r.reporting_week_id
   where r.business_unit_id = p_bu and w.id = p_week and w.status = 'FINAL_LOCKED' and w.reporting_state = 'NORMAL'
     and t.status <> 'DONE' and t.deleted_at is null;
$$;

create or replace function ai_remark_candidates() returns table (business_unit_id uuid, reporting_week_id uuid, week_number int, unit_name text, tasks int)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.business_unit_id, w.id, w.week_number, b.name, count(distinct t.id)::int
    from reporting_weeks w
    join weekly_reports r on r.reporting_week_id = w.id
    join business_units b on b.id = r.business_unit_id and b.status = 'ACTIVE' and b.reports_weekly
    join smart_goals g on g.weekly_report_id = r.id and g.deleted_at is null
    join tasks t on t.smart_goal_id = g.id and t.deleted_at is null and t.status <> 'DONE'
   where w.status = 'FINAL_LOCKED' and w.reporting_state = 'NORMAL'
     and coalesce(w.finalized_at, w.final_lock_at) >= app_now() - make_interval(days => coalesce((select (value)::text::int from ai_settings where key = 'remark_lookback_days'), 21))
   group by r.business_unit_id, w.id, w.week_number, b.name;
$$;

-- ------------------------------------------------------------------ the lifecycle: request, one reminder, one escalation
create or replace function ai_remark_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c record; q record; u uuid; v_req uuid; v_nid uuid; v_dedupe text; v_msg text; v_title text;
  v_deadline int := coalesce((select (value)::text::int from ai_settings where key = 'remark_deadline_days'), 3);
  v_remind int := coalesce((select (value)::text::int from ai_settings where key = 'remark_reminder_days'), 2);
  v_escalate int := coalesce((select (value)::text::int from ai_settings where key = 'remark_escalate_days'), 5);
  v_created int := 0; v_reminded int := 0; v_escalated int := 0;
begin
  if ai_action_mode('REQUEST_REMARK') is distinct from 'AUTO' then return jsonb_build_object('skipped', 'request_remark is not automatic'); end if;

  -- 1. one batched request for each unit and week that has unresolved tasks
  for c in select * from ai_remark_candidates() loop
    v_req := null;
    insert into ai_remark_requests (business_unit_id, reporting_week_id, task_count, due_at)
    values (c.business_unit_id, c.reporting_week_id, c.tasks, app_now() + make_interval(days => v_deadline)) on conflict (business_unit_id, reporting_week_id) do nothing returning id into v_req;
    if v_req is null then continue; end if;
    v_title := format('Week %s: remarks needed on %s task%s', c.week_number, c.tasks, case when c.tasks = 1 then '' else 's' end);
    v_msg := format('%s did not finish %s task%s in week %s. Please open 4COREPAL, then Remarks, and give the reason for each by %s. This is a request for an explanation, not a judgement: tasks that were blocked, waiting on others or no longer needed are exactly what to record.',
      c.unit_name, c.tasks, case when c.tasks = 1 then '' else 's' end, c.week_number, to_char(app_now() + make_interval(days => v_deadline), 'DD Mon YYYY'));
    for u in select ai_remark_recipients(c.business_unit_id) loop
      v_dedupe := 'airr:' || v_req || ':' || u;
      perform notify_users(array[u], 'AI_REMARK_REQUEST', 'ai_remark_request', v_req::text, v_title, v_msg, v_dedupe);
      select id into v_nid from notifications where user_id = u and dedupe_key = v_dedupe;
      insert into ai_communications (recipient_user_id, channel, kind, subject, body, remark_request_id, business_unit_id, reporting_week_id, notification_id, delivery_status, follow_up_status, dedupe_key)
      values (u, 'IN_APP', 'REMARK_REQUEST', v_title, v_msg, v_req, c.business_unit_id, c.reporting_week_id, v_nid, 'SENT', 'PENDING', v_dedupe) on conflict do nothing;
    end loop;
    perform write_audit(null, 'AI_REMARK_REQUESTED', 'ai_remark_request', v_req::text, null, jsonb_build_object('business_unit_id', c.business_unit_id, 'week', c.week_number, 'tasks', c.tasks), null, c.business_unit_id);
    v_created := v_created + 1;
  end loop;

  -- 2. one reminder for a request that is still open after the reminder days
  if ai_action_mode('SEND_REMINDER') = 'AUTO' then
    for q in select r.*, b.name unit_name, w.week_number from ai_remark_requests r join business_units b on b.id = r.business_unit_id join reporting_weeks w on w.id = r.reporting_week_id
              where r.status in ('PENDING', 'PARTIAL') and r.reminded_at is null and app_now() >= r.requested_at + make_interval(days => v_remind) loop
      v_title := format('Reminder: remarks are still needed for week %s', q.week_number);
      v_msg := format('%s still has tasks from week %s without a remark. Please open 4COREPAL, then Remarks, by %s.', q.unit_name, q.week_number, to_char(q.due_at, 'DD Mon YYYY'));
      for u in select ai_remark_recipients(q.business_unit_id) loop
        v_dedupe := 'airm:' || q.id || ':' || u;
        perform notify_users(array[u], 'AI_REMARK_REMINDER', 'ai_remark_request', q.id::text, v_title, v_msg, v_dedupe);
        select id into v_nid from notifications where user_id = u and dedupe_key = v_dedupe;
        insert into ai_communications (recipient_user_id, channel, kind, subject, body, remark_request_id, business_unit_id, reporting_week_id, notification_id, delivery_status, follow_up_status, dedupe_key)
        values (u, 'IN_APP', 'REMINDER', v_title, v_msg, q.id, q.business_unit_id, q.reporting_week_id, v_nid, 'SENT', 'PENDING', v_dedupe) on conflict do nothing;
      end loop;
      update ai_remark_requests set reminded_at = app_now() where id = q.id;
      v_reminded := v_reminded + 1;
    end loop;
  end if;

  -- 3. an unanswered request goes to the executives once, after the escalation days
  for q in select r.*, b.name unit_name, w.week_number,
                  (r.task_count - (select count(*) from ai_task_remarks x where x.request_id = r.id))::int outstanding
             from ai_remark_requests r join business_units b on b.id = r.business_unit_id join reporting_weeks w on w.id = r.reporting_week_id
            where r.status in ('PENDING', 'PARTIAL') and r.escalated_at is null and app_now() >= r.requested_at + make_interval(days => v_escalate) loop
    v_title := format('%s has not given remarks for week %s', q.unit_name, q.week_number);
    v_msg := format('%s task%s from week %s still %s no remark, %s days after the request. The unit lead was reminded. Open 4COREPAL, then Monitoring.', q.outstanding, case when q.outstanding = 1 then '' else 's' end, q.week_number, case when q.outstanding = 1 then 'has' else 'have' end, v_escalate);
    for u in select ai_executive_recipients() loop
      v_dedupe := 'aiesc:' || q.id || ':' || u;
      perform notify_users(array[u], 'AI_ESCALATION', 'ai_remark_request', q.id::text, v_title, v_msg, v_dedupe);
      select id into v_nid from notifications where user_id = u and dedupe_key = v_dedupe;
      insert into ai_communications (recipient_user_id, channel, kind, subject, body, remark_request_id, business_unit_id, reporting_week_id, notification_id, delivery_status, follow_up_status, dedupe_key)
      values (u, 'IN_APP', 'ESCALATION', v_title, v_msg, q.id, q.business_unit_id, q.reporting_week_id, v_nid, 'SENT', 'NONE', v_dedupe) on conflict do nothing;
    end loop;
    update ai_remark_requests set escalated_at = app_now(), status = 'ESCALATED' where id = q.id;
    perform write_audit(null, 'AI_REMARK_ESCALATED', 'ai_remark_request', q.id::text, null, jsonb_build_object('outstanding', q.outstanding), null, q.business_unit_id);
    v_escalated := v_escalated + 1;
  end loop;

  return jsonb_build_object('requested', v_created, 'reminded', v_reminded, 'escalated', v_escalated);
end $$;

-- ------------------------------------------------------------------ giving the remarks
-- p_items: [{ "taskId": uuid, "reasonCode": "...", "remark": "..." }]. All or none. Only a person of the unit may answer for it, only for tasks that are on the request,
-- and each task once: a remark is a record of what was said, so it is not edited later (a correction is a conversation with an executive, not an overwrite).
create or replace function ai_submit_remarks(p_actor uuid, p_request uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r ai_remark_requests; it jsonb; v_task uuid; v_reason text; v_text text; v_answered int; v_outstanding int; v_status text;
begin
  perform require_permission(p_actor, 'ai.remark.submit');
  if not ai_enabled() then raise exception 'AI_DISABLED'; end if;
  select * into r from ai_remark_requests where id = p_request for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if actor_bu(p_actor) is distinct from r.business_unit_id then raise exception 'BU_SCOPE_DENIED'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 200 then raise exception 'VALIDATION_ERROR' using detail = 'give a remark for at least one task'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_task := (it->>'taskId')::uuid; v_reason := it->>'reasonCode'; v_text := btrim(coalesce(it->>'remark', ''));
    if not exists (select 1 from ai_unresolved_tasks(r.business_unit_id, r.reporting_week_id) x where x.task_id = v_task) then raise exception 'VALIDATION_ERROR' using detail = 'a task is not on this request'; end if;
    if char_length(v_text) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'a remark can be up to 2000 characters'; end if;
    if v_reason = 'OTHER' and v_text = '' then raise exception 'VALIDATION_ERROR' using detail = 'say what the reason is when it is Other'; end if;
    begin
      insert into ai_task_remarks (request_id, task_id, business_unit_id, reason_code, remark, author_user_id) values (p_request, v_task, r.business_unit_id, v_reason, v_text, p_actor);
    exception when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'a remark has already been given for a task';
    when check_violation then raise exception 'VALIDATION_ERROR' using detail = 'that reason is not one of the choices';
    end;
  end loop;
  select count(*)::int into v_answered from ai_task_remarks where request_id = p_request;
  select count(*)::int into v_outstanding from ai_unresolved_tasks(r.business_unit_id, r.reporting_week_id) x where not exists (select 1 from ai_task_remarks m where m.request_id = p_request and m.task_id = x.task_id);
  v_status := case when v_outstanding = 0 then 'ANSWERED' when r.status = 'ESCALATED' then 'ESCALATED' else 'PARTIAL' end;
  update ai_remark_requests set status = v_status, answered_at = case when v_outstanding = 0 then app_now() else answered_at end where id = p_request;
  update ai_communications set acknowledged_at = coalesce(acknowledged_at, app_now()), responded_at = app_now(), follow_up_status = case when v_outstanding = 0 then 'DONE' else follow_up_status end
   where remark_request_id = p_request and recipient_user_id = p_actor;
  if v_outstanding = 0 then update ai_communications set follow_up_status = 'DONE' where remark_request_id = p_request and follow_up_status = 'PENDING'; end if;
  perform write_audit(p_actor, 'AI_REMARKS_SUBMITTED', 'ai_remark_request', p_request::text, null, jsonb_build_object('remarks', jsonb_array_length(p_items), 'outstanding', v_outstanding), null, r.business_unit_id);
  return jsonb_build_object('answered', v_answered, 'outstanding', v_outstanding, 'status', v_status);
end $$;

-- what the form shows: the request, its tasks and any remark already given. An invoker function: row-level security decides what the person may see.
create or replace function read_ai_remark_request(p_request uuid) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select case when r.id is null then null else jsonb_build_object(
    'id', r.id, 'status', r.status, 'dueAt', r.due_at, 'requestedAt', r.requested_at, 'businessUnitId', r.business_unit_id, 'unit', b.name, 'weekNumber', w.week_number, 'weekStart', w.week_start_at, 'weekEnd', w.week_end_at,
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'description', t.description, 'status', t.status, 'goal', g.title,
                  'reasonCode', m.reason_code, 'remark', m.remark) order by g.position, t.position)
               from tasks t join smart_goals g on g.id = t.smart_goal_id and g.deleted_at is null join weekly_reports wr on wr.id = g.weekly_report_id
               left join ai_task_remarks m on m.task_id = t.id and m.request_id = r.id
               where wr.business_unit_id = r.business_unit_id and wr.reporting_week_id = r.reporting_week_id and t.deleted_at is null and t.status <> 'DONE'), '[]'::jsonb)) end
  from (select 1) x left join ai_remark_requests r on r.id = p_request
  left join business_units b on b.id = r.business_unit_id left join reporting_weeks w on w.id = r.reporting_week_id;
$$;

-- ------------------------------------------------------------------ findings: what the scan notices
-- Each is a recorded observation with its evidence and a fingerprint, so the same one found again is the same finding.
create or replace function ai_scan_findings() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n int := 0; v_k int; v_drop numeric := coalesce((select (value)::text::numeric from ai_settings where key = 'score_drop_points'), 15);
  v_lookback int := coalesce((select (value)::text::int from ai_settings where key = 'remark_lookback_days'), 21);
begin
  if ai_action_mode('CREATE_FINDING') is distinct from 'AUTO' then return 0; end if;

  -- a final week with no report filed
  insert into ai_findings (kind, business_unit_id, reporting_week_id, quarter_id, severity, summary, evidence, fingerprint)
  select 'MISSED_REPORT', c.business_unit_id, c.reporting_week_id, w.quarter_id, 'MEDIUM',
         format('%s filed no report for week %s, so the week scored zero.', b.name, w.week_number),
         jsonb_build_object('week', w.week_number, 'compliance', c.status, 'determined_at', c.determined_at), 'missed:' || c.business_unit_id || ':' || c.reporting_week_id
    from weekly_compliance c join reporting_weeks w on w.id = c.reporting_week_id join business_units b on b.id = c.business_unit_id and b.status = 'ACTIVE' and b.reports_weekly
   where c.status = 'NON_COMPLIANT' and w.status = 'FINAL_LOCKED' and w.reporting_state = 'NORMAL' and coalesce(w.finalized_at, w.final_lock_at) >= app_now() - make_interval(days => v_lookback)
  on conflict (fingerprint) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- the same unit missing the previous normal week as well
  insert into ai_findings (kind, business_unit_id, reporting_week_id, quarter_id, severity, summary, evidence, fingerprint)
  select 'CONSECUTIVE_MISSED_REPORTS', c.business_unit_id, c.reporting_week_id, w.quarter_id, 'HIGH',
         format('%s filed no report for weeks %s and %s in a row.', b.name, p.week_number, w.week_number),
         jsonb_build_object('weeks', jsonb_build_array(p.week_number, w.week_number)), 'missed2:' || c.business_unit_id || ':' || c.reporting_week_id
    from weekly_compliance c join reporting_weeks w on w.id = c.reporting_week_id
    join business_units b on b.id = c.business_unit_id and b.status = 'ACTIVE' and b.reports_weekly
    join lateral (select pw.id, pw.week_number from reporting_weeks pw where pw.quarter_id = w.quarter_id and pw.reporting_state = 'NORMAL' and pw.week_start_at < w.week_start_at order by pw.week_start_at desc limit 1) p on true
    join weekly_compliance pc on pc.business_unit_id = c.business_unit_id and pc.reporting_week_id = p.id and pc.status = 'NON_COMPLIANT'
   where c.status = 'NON_COMPLIANT' and w.status = 'FINAL_LOCKED' and w.reporting_state = 'NORMAL' and coalesce(w.finalized_at, w.final_lock_at) >= app_now() - make_interval(days => v_lookback)
  on conflict (fingerprint) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- a score that fell sharply from the previous normal week (the latest calculation of each week)
  insert into ai_findings (kind, business_unit_id, reporting_week_id, quarter_id, severity, summary, evidence, fingerprint)
  select 'SCORE_DROP', s.business_unit_id, s.reporting_week_id, w.quarter_id, case when s.final_score <= 40 then 'HIGH' else 'MEDIUM' end,
         format('%s scored %s in week %s, down %s points from %s in week %s.', b.name, round(s.final_score, 1), w.week_number, round(p.final_score - s.final_score, 1), round(p.final_score, 1), p.week_number),
         jsonb_build_object('week', w.week_number, 'score', s.final_score, 'previous_week', p.week_number, 'previous_score', p.final_score), 'drop:' || s.business_unit_id || ':' || s.reporting_week_id
    from (select distinct on (business_unit_id, reporting_week_id) * from weekly_score_snapshots order by business_unit_id, reporting_week_id, version_number desc) s
    join reporting_weeks w on w.id = s.reporting_week_id and w.status = 'FINAL_LOCKED' and w.reporting_state = 'NORMAL'
    join business_units b on b.id = s.business_unit_id and b.status = 'ACTIVE' and b.reports_weekly
    join lateral (select x.final_score, pw.week_number from (select distinct on (business_unit_id, reporting_week_id) * from weekly_score_snapshots order by business_unit_id, reporting_week_id, version_number desc) x
                  join reporting_weeks pw on pw.id = x.reporting_week_id and pw.quarter_id = w.quarter_id and pw.reporting_state = 'NORMAL' and pw.week_start_at < w.week_start_at
                  where x.business_unit_id = s.business_unit_id order by pw.week_start_at desc limit 1) p on true
   where s.final_score is not null and p.final_score is not null and p.final_score - s.final_score >= v_drop
     and coalesce(w.finalized_at, w.final_lock_at) >= app_now() - make_interval(days => v_lookback)
  on conflict (fingerprint) do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end $$;

-- ------------------------------------------------------------------ the daily run, called by the existing scheduler
create or replace function ai_run_jobs() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tz text; local_now timestamp; v_due time; j jsonb; v_findings int; v_remarks jsonb;
begin
  if not ai_enabled() then return jsonb_build_object('skipped', 'disabled'); end if;
  tz := coalesce(ai_setting('timezone') #>> '{}', 'Africa/Lagos');
  v_due := coalesce(ai_setting('schedule_daily_time') #>> '{}', '07:00')::time;
  local_now := app_now() at time zone tz;
  if local_now::time < v_due then return jsonb_build_object('waiting', 'before the daily time'); end if;
  j := ai_job_begin('daily', 'daily:' || local_now::date, app_now());
  if not (j->>'run')::boolean then return jsonb_build_object('skipped', j->>'status'); end if;
  begin
    v_findings := ai_scan_findings();
    v_remarks := ai_remark_tick();
    perform ai_job_finish((j->>'id')::uuid, true, null, jsonb_build_object('findings', v_findings, 'remarks', v_remarks));
    return jsonb_build_object('ran', 'daily', 'findings', v_findings, 'remarks', v_remarks);
  exception when others then
    perform ai_job_finish((j->>'id')::uuid, false, sqlerrm);
    return jsonb_build_object('failed', 'daily');
  end;
end $$;

-- ------------------------------------------------------------------ one guarded call from the existing scheduler
do $$
declare v_def text; a text := 'begin perform maybe_purge_transient_data();';
begin
  v_def := pg_get_functiondef('run_scheduled_jobs()'::regprocedure);
  if position(a in v_def) = 0 then raise exception 'run_scheduled_jobs changed'; end if;
  if position('ai_run_jobs' in v_def) > 0 then return; end if;
  execute replace(v_def, a, 'begin perform ai_run_jobs(); exception when others then null; end; ' || a);   -- a failure here never stops the scheduler's own work
end $$;

select lock_down_function_grants();
