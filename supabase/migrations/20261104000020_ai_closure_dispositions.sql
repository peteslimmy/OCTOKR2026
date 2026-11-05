-- 4COREPAL phase 5 (part 2): the monthly closure of activities that stay open, dispositions, and the daily and monthly runs that tie phase 4 and 5 together.
--
-- An "activity" the application records is a weekly goal with its tasks. A goal set again and again under the same wording without being finished is what this
-- review asks the unit about. The match is on the exact wording (lower-cased, punctuation and spacing ignored): conservative on purpose, so the unit is never asked about
-- two different goals as if they were one. (The executive report finds more by similar wording; it shows them, it does not ask about them.)
-- A response is a proposed disposition. It changes nothing official: no goal is cancelled, retired, re-dated or re-scored. An approved disposition is the recorded
-- decision, and it stops the unit being asked about the same goal again until the goal is set once more.

-- Admins may submit corrective plans (a proposal): a Super Admin other than the submitter decides them. With one Super Admin only, an Admin submits and the Super Admin approves.
insert into role_permissions (role_id, permission_id) select r.id, p.id from roles r, permissions p where r.code = 'ADMIN' and p.code = 'ai.action.assign' on conflict do nothing;

alter table ai_dispositions add column closure_request_id uuid;
create unique index ai_dispositions_once on ai_dispositions (closure_request_id, subject_id) where closure_request_id is not null;

insert into ai_settings (key, value, kind, label, help) values
  ('closure_deadline_days', '5', 'number', 'Days a unit has to answer the monthly review of open activities', null);

create table ai_closure_requests (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references business_units(id),
  month            date not null,
  goal_count       int  not null check (goal_count > 0),
  status           text not null default 'PENDING' check (status in ('PENDING', 'PARTIAL', 'ANSWERED', 'ESCALATED')),
  requested_at     timestamptz not null default app_now(),
  due_at           timestamptz not null,
  reminded_at      timestamptz,
  escalated_at     timestamptz,
  answered_at      timestamptz,
  unique (business_unit_id, month)
);
create table ai_closure_items (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null references ai_closure_requests(id) on delete cascade,
  subject_goal_id uuid not null references smart_goals(id),
  title           text not null,
  weeks_set       int not null,
  first_week      int not null,
  last_week       int not null,
  history         jsonb not null default '[]'::jsonb,        -- each week it was set: number, whether done, tasks done of total
  unique (request_id, subject_goal_id)
);
alter table ai_dispositions add constraint ai_dispositions_request_fk foreign key (closure_request_id) references ai_closure_requests(id);
alter table ai_closure_requests enable row level security;
alter table ai_closure_items enable row level security;
grant select on ai_closure_requests, ai_closure_items to authenticated;
create policy read_scope on ai_closure_requests for select to authenticated using ((select auth_has_permission('ai.insights.org')) or ((select auth_has_permission('ai.insights.bu')) and business_unit_id = (select auth_bu())));
create policy read_scope on ai_closure_items for select to authenticated using (exists (select 1 from ai_closure_requests q where q.id = request_id));

-- ------------------------------------------------------------------ which goals are asked about
create or replace function ai_closure_candidates() returns table (business_unit_id uuid, unit_name text, title text, weeks_set int, first_week int, last_week int, latest_goal uuid, history jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  with g as (
    select r.business_unit_id bu, b.name unit, x.id goal_id, x.title, lower(btrim(regexp_replace(x.title, '[^a-zA-Z0-9]+', ' ', 'g'))) k, w.week_number wn, w.week_start_at ws, goal_is_done(x.id) done,
           (select count(*) filter (where t.status = 'DONE') from tasks t where t.smart_goal_id = x.id and t.deleted_at is null) td,
           (select count(*) from tasks t where t.smart_goal_id = x.id and t.deleted_at is null) tt
      from smart_goals x join weekly_reports r on r.id = x.weekly_report_id join reporting_weeks w on w.id = r.reporting_week_id
      join business_units b on b.id = r.business_unit_id and b.status = 'ACTIVE' and b.reports_weekly
     where x.deleted_at is null and r.submission_status = 'SUBMITTED' and w.status = 'FINAL_LOCKED' and w.reporting_state = 'NORMAL')
  select g.bu, max(g.unit), (array_agg(g.title order by g.ws desc))[1], count(distinct g.wn)::int, min(g.wn), max(g.wn), (array_agg(g.goal_id order by g.ws desc))[1],
         jsonb_agg(jsonb_build_object('week', g.wn, 'done', g.done, 'tasksDone', g.td, 'tasksTotal', g.tt) order by g.ws)
    from g where g.k <> ''
   group by g.bu, g.k
  having count(distinct g.wn) filter (where not g.done) >= coalesce((select (value)::text::int from ai_settings where key = 'carry_over_weeks_threshold'), 3)
     and (array_agg(g.done order by g.ws desc))[1] = false
     and max(g.ws) >= app_now() - interval '21 days'
     and not exists (select 1 from ai_dispositions d where d.subject_type = 'GOAL' and d.status in ('PROPOSED', 'APPROVED', 'APPLIED')
                      and d.subject_id in (select y.goal_id from g y where y.bu = g.bu and y.k = g.k) and d.proposed_at >= max(g.ws));
$$;

-- ------------------------------------------------------------------ the monthly review: one request per unit and month, one reminder, one escalation
create or replace function ai_closure_tick(p_month date default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c record; q record; i record; u uuid; v_req uuid; v_month date := coalesce(p_month, date_trunc('month', app_now() at time zone 'Africa/Lagos')::date);
  v_deadline int := coalesce((select (value)::text::int from ai_settings where key = 'closure_deadline_days'), 5);
  v_remind int := coalesce((select (value)::text::int from ai_settings where key = 'remark_reminder_days'), 2);
  v_escalate int := coalesce((select (value)::text::int from ai_settings where key = 'remark_escalate_days'), 5);
  v_created int := 0; v_reminded int := 0; v_escalated int := 0; v_cases int := 0; v_n int; v_title text; v_msg text; v_nid uuid; v_key text; v_case uuid; v_existed boolean; v_fp text;
begin
  if ai_action_mode('REQUEST_EXPLANATION') is distinct from 'AUTO' then return jsonb_build_object('skipped', 'request_explanation is not automatic'); end if;
  for c in select business_unit_id, max(unit_name) unit_name, count(*)::int goals, max(weeks_set) longest from ai_closure_candidates() group by business_unit_id loop
    v_req := null;
    insert into ai_closure_requests (business_unit_id, month, goal_count, due_at) values (c.business_unit_id, v_month, c.goals, app_now() + make_interval(days => v_deadline))
      on conflict (business_unit_id, month) do nothing returning id into v_req;
    if v_req is null then continue; end if;
    insert into ai_closure_items (request_id, subject_goal_id, title, weeks_set, first_week, last_week, history)
      select v_req, latest_goal, title, weeks_set, first_week, last_week, history from ai_closure_candidates() x where x.business_unit_id = c.business_unit_id;
    v_title := format('Monthly review: %s open activit%s', c.goals, case when c.goals = 1 then 'y' else 'ies' end);
    v_msg := format('%s has %s goal%s that %s been set again and again without being finished (the longest for %s weeks). Please open 4COREPAL, then Closure, and say what should happen to each by %s: finished but not recorded, still in progress, partly done, stepped down, no longer needed, deferred, blocked, or changed in scope. Nothing is cancelled or changed by your answer until it has been approved.',
      c.unit_name, c.goals, case when c.goals = 1 then '' else 's' end, case when c.goals = 1 then 'has' else 'have' end, c.longest, to_char(app_now() + make_interval(days => v_deadline), 'DD Mon YYYY'));
    foreach u in array coalesce(array(select ai_remark_recipients(c.business_unit_id)), '{}') loop
      v_key := 'aicl:' || v_req || ':' || u;
      perform notify_users(array[u], 'AI_CLOSURE_REQUEST', 'ai_closure_request', v_req::text, v_title, v_msg, v_key);
      select id into v_nid from notifications where user_id = u and dedupe_key = v_key;
      insert into ai_communications (recipient_user_id, channel, kind, subject, body, business_unit_id, notification_id, delivery_status, follow_up_status, dedupe_key)
      values (u, 'IN_APP', 'CLOSURE_REQUEST', v_title, v_msg, c.business_unit_id, v_nid, 'SENT', 'PENDING', v_key) on conflict do nothing;
    end loop;
    perform write_audit(null, 'AI_CLOSURE_REQUESTED', 'ai_closure_request', v_req::text, null, jsonb_build_object('goals', c.goals, 'month', v_month), null, c.business_unit_id);
    v_created := v_created + 1;
    -- a unit carrying several goals at once is a case: management should look, not only the unit
    if c.goals >= 3 then
      v_fp := 'carry:' || c.business_unit_id || ':' || to_char(v_month, 'YYYY-MM');
      v_existed := exists (select 1 from ai_cases where fingerprint = v_fp);
      v_case := ai_open_case(v_fp, c.unit_name || ': ' || c.goals || ' goals carried forward without being finished', 'REPEATED_DELAYS',
        format('%s has %s goals set repeatedly without being finished, the longest for %s weeks.', c.unit_name, c.goals, c.longest), c.business_unit_id, case when c.goals >= 5 or c.longest >= 6 then 'HIGH' else 'MEDIUM' end,
        'Goals with identical wording have been set in several finished weeks and were not done in the latest. Whether they are still wanted, blocked or badly sized is not known: the unit has been asked.',
        '[]'::jsonb, 'Review the monthly closure answers with the unit lead: close or restructure what is no longer wanted, and unblock the rest.',
        (select jsonb_agg(jsonb_build_object('kind', 'GOAL', 'ref_table', 'smart_goals', 'ref_id', x.latest_goal::text, 'summary', format('"%s": set in %s weeks (weeks %s to %s), unfinished in the latest', left(x.title, 120), x.weeks_set, x.first_week, x.last_week), 'value', x.history))
           from ai_closure_candidates() x where x.business_unit_id = c.business_unit_id));
      if v_case is not null and not v_existed then v_cases := v_cases + 1; end if;
    end if;
  end loop;

  if ai_action_mode('SEND_REMINDER') = 'AUTO' then
    for q in select r.*, b.name unit_name from ai_closure_requests r join business_units b on b.id = r.business_unit_id
              where r.status in ('PENDING', 'PARTIAL') and r.reminded_at is null and app_now() >= r.requested_at + make_interval(days => v_remind) loop
      v_title := 'Reminder: the monthly review of open activities is waiting';
      v_msg := format('%s has not yet answered the monthly review of open activities (due %s). Open 4COREPAL, then Closure.', q.unit_name, to_char(q.due_at, 'DD Mon YYYY'));
      foreach u in array coalesce(array(select ai_remark_recipients(q.business_unit_id)), '{}') loop
        v_key := 'aiclm:' || q.id || ':' || u;
        perform notify_users(array[u], 'AI_REMARK_REMINDER', 'ai_closure_request', q.id::text, v_title, v_msg, v_key);
        select id into v_nid from notifications where user_id = u and dedupe_key = v_key;
        insert into ai_communications (recipient_user_id, channel, kind, subject, body, business_unit_id, notification_id, delivery_status, follow_up_status, dedupe_key)
        values (u, 'IN_APP', 'REMINDER', v_title, v_msg, q.business_unit_id, v_nid, 'SENT', 'PENDING', v_key) on conflict do nothing;
      end loop;
      update ai_closure_requests set reminded_at = app_now() where id = q.id;
      v_reminded := v_reminded + 1;
    end loop;
  end if;

  for q in select r.*, b.name unit_name from ai_closure_requests r join business_units b on b.id = r.business_unit_id
            where r.status in ('PENDING', 'PARTIAL') and r.escalated_at is null and app_now() >= r.requested_at + make_interval(days => v_escalate) loop
    v_title := format('%s has not answered the monthly review', q.unit_name);
    v_msg := format('The monthly review of %s open activities for %s is still unanswered %s days after it was sent. Open 4COREPAL, then Monitoring.', q.goal_count, q.unit_name, v_escalate);
    foreach u in array coalesce(array(select ai_executive_recipients()), '{}') loop
      v_key := 'aiclx:' || q.id || ':' || u;
      perform notify_users(array[u], 'AI_ESCALATION', 'ai_closure_request', q.id::text, v_title, v_msg, v_key);
      select id into v_nid from notifications where user_id = u and dedupe_key = v_key;
      insert into ai_communications (recipient_user_id, channel, kind, subject, body, business_unit_id, notification_id, delivery_status, follow_up_status, dedupe_key)
      values (u, 'IN_APP', 'ESCALATION', v_title, v_msg, q.business_unit_id, v_nid, 'SENT', 'NONE', v_key) on conflict do nothing;
    end loop;
    update ai_closure_requests set escalated_at = app_now(), status = 'ESCALATED' where id = q.id;
    v_escalated := v_escalated + 1;
  end loop;
  return jsonb_build_object('requested', v_created, 'cases', v_cases, 'reminded', v_reminded, 'escalated', v_escalated);
end $$;

-- ------------------------------------------------------------------ the unit's answers
-- p_items: [{ goalId, option, explanation, evidenceNote? }]. All or none, own unit only, each goal once. Two options only record the unit's position and change nothing to decide
-- (still in progress, blocked); every other is a proposal that needs a decision by someone other than the proposer.
create or replace function ai_submit_dispositions(p_actor uuid, p_request uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r ai_closure_requests; it jsonb; v_goal uuid; v_opt text; v_text text; v_id uuid; v_appr uuid; u uuid; v_answered int; v_status text; v_proposed int := 0; v_title text;
begin
  perform require_permission(p_actor, 'ai.remark.submit');
  if not ai_enabled() then raise exception 'AI_DISABLED'; end if;
  select * into r from ai_closure_requests where id = p_request for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if actor_bu(p_actor) is distinct from r.business_unit_id then raise exception 'BU_SCOPE_DENIED'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then raise exception 'VALIDATION_ERROR' using detail = 'answer at least one goal'; end if;
  if (select mode from ai_action_policies where action_type = 'PROPOSE_ACTIVITY_CHANGE') = 'DISABLED' then raise exception 'VALIDATION_ERROR' using detail = 'activity changes are switched off'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_goal := (it->>'goalId')::uuid; v_opt := it->>'option'; v_text := btrim(coalesce(it->>'explanation', ''));
    select title into v_title from ai_closure_items where request_id = p_request and subject_goal_id = v_goal;
    if v_title is null then raise exception 'VALIDATION_ERROR' using detail = 'a goal is not on this review'; end if;
    if v_opt not in ('COMPLETED_NOT_RECORDED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'STEPPED_DOWN', 'NO_LONGER_REQUIRED', 'DEFERRED', 'BLOCKED', 'SCOPE_CHANGED') then raise exception 'VALIDATION_ERROR' using detail = 'that is not one of the choices'; end if;
    if char_length(v_text) > 4000 then raise exception 'VALIDATION_ERROR' using detail = 'an explanation can be up to 4000 characters'; end if;
    if v_opt not in ('IN_PROGRESS', 'COMPLETED_NOT_RECORDED') and char_length(v_text) < 5 then raise exception 'VALIDATION_ERROR' using detail = 'explain your choice'; end if;
    begin
      insert into ai_dispositions (business_unit_id, subject_type, subject_id, option_code, explanation, evidence_note, closure_request_id, status, proposed_by)
      values (r.business_unit_id, 'GOAL', v_goal, v_opt, v_text, nullif(left(btrim(coalesce(it->>'evidenceNote', '')), 2000), ''), p_request, case when v_opt in ('IN_PROGRESS', 'BLOCKED') then 'APPLIED' else 'PROPOSED' end, p_actor) returning id into v_id;
    exception when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'a goal has already been answered';
    end;
    if v_opt not in ('IN_PROGRESS', 'BLOCKED') then
      insert into ai_approvals (action_type, subject_type, subject_id, proposal, requested_by, by_agent)
      values ('PROPOSE_ACTIVITY_CHANGE', 'disposition', v_id::text, jsonb_build_object('goal', v_goal, 'title', v_title, 'option', v_opt, 'explanation', v_text, 'unit', r.business_unit_id), p_actor, false) returning id into v_appr;
      v_proposed := v_proposed + 1;
      foreach u in array coalesce(array(select u2.id from users u2 where u2.status = 'ACTIVE' and actor_has_permission(u2.id, 'ai.approval.decide') and u2.id <> p_actor), '{}') loop
        perform notify_users(array[u], 'AI_APPROVAL_REQUEST', 'ai_approval', v_appr::text, 'A proposal about an open activity needs your decision', left(v_title, 120) || ': ' || replace(lower(v_opt), '_', ' ') || '. Open 4COREPAL, then Approvals.', 'aiappr:' || v_appr || ':' || u);
      end loop;
    end if;
  end loop;
  select count(*)::int into v_answered from ai_dispositions where closure_request_id = p_request;
  v_status := case when v_answered >= r.goal_count then 'ANSWERED' when r.status = 'ESCALATED' then 'ESCALATED' else 'PARTIAL' end;
  update ai_closure_requests set status = v_status, answered_at = case when v_status = 'ANSWERED' then app_now() else answered_at end where id = p_request;
  update ai_communications set acknowledged_at = coalesce(acknowledged_at, app_now()), responded_at = app_now() where business_unit_id = r.business_unit_id and kind = 'CLOSURE_REQUEST' and recipient_user_id = p_actor
     and notification_id in (select id from notifications where entity_type = 'ai_closure_request' and entity_id = p_request::text);
  if v_status = 'ANSWERED' then update ai_communications set follow_up_status = 'DONE' where follow_up_status = 'PENDING' and notification_id in (select id from notifications where entity_type = 'ai_closure_request' and entity_id = p_request::text); end if;
  perform write_audit(p_actor, 'AI_DISPOSITIONS_SUBMITTED', 'ai_closure_request', p_request::text, null, jsonb_build_object('answers', jsonb_array_length(p_items), 'proposed', v_proposed), null, r.business_unit_id);
  return jsonb_build_object('answered', v_answered, 'goals', r.goal_count, 'status', v_status, 'proposed', v_proposed);
end $$;

create or replace function read_ai_closure_request(p_request uuid) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select case when r.id is null then null else jsonb_build_object(
    'id', r.id, 'status', r.status, 'dueAt', r.due_at, 'requestedAt', r.requested_at, 'businessUnitId', r.business_unit_id, 'unit', b.name, 'month', r.month,
    'items', coalesce((select jsonb_agg(jsonb_build_object('goalId', i.subject_goal_id, 'title', i.title, 'weeksSet', i.weeks_set, 'firstWeek', i.first_week, 'lastWeek', i.last_week, 'history', i.history,
                       'option', d.option_code, 'explanation', d.explanation, 'dispositionStatus', d.status) order by i.weeks_set desc, i.title)
                 from ai_closure_items i left join ai_dispositions d on d.closure_request_id = r.id and d.subject_id = i.subject_goal_id where i.request_id = r.id), '[]'::jsonb)) end
  from (select 1) x left join ai_closure_requests r on r.id = p_request left join business_units b on b.id = r.business_unit_id;
$$;

-- ------------------------------------------------------------------ the runs
create or replace function ai_draft_plans() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; v_n int := 0;
begin
  if ai_action_mode('CREATE_CORRECTIVE_ACTION') is null then return 0; end if;       -- a drafted plan is a recommendation; it is not drafted when the action is switched off
  for c in select id from ai_cases where severity in ('HIGH', 'CRITICAL') and status not in ('RESOLVED', 'CLOSED') loop
    if ai_draft_corrective_plan(c.id) is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- Every step is its own sub-transaction: one failing never stops the others, the failure is recorded on the job, and because every step is idempotent the next run is safe.
create or replace function ai_run_jobs() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tz text; local_now timestamp; v_due time; v_month_due time; j jsonb; v_res jsonb := '{}'::jsonb; v_errs text := ''; v_n jsonb; v_last boolean;
begin
  if not ai_enabled() then return jsonb_build_object('skipped', 'disabled'); end if;
  tz := coalesce(ai_setting('timezone') #>> '{}', 'Africa/Lagos');
  v_due := coalesce(ai_setting('schedule_daily_time') #>> '{}', '07:00')::time;
  v_month_due := coalesce(ai_setting('schedule_monthly_time') #>> '{}', '08:00')::time;
  local_now := app_now() at time zone tz;
  if local_now::time < v_due then return jsonb_build_object('waiting', 'before the daily time'); end if;

  j := ai_job_begin('daily', 'daily:' || local_now::date, app_now());
  if (j->>'run')::boolean then
    begin v_n := to_jsonb(ai_scan_findings()); v_res := v_res || jsonb_build_object('findings', v_n); exception when others then v_errs := v_errs || 'findings: ' || sqlerrm || '; '; end;
    begin v_n := to_jsonb(ai_cases_from_findings()); v_res := v_res || jsonb_build_object('casesFromFindings', v_n); exception when others then v_errs := v_errs || 'cases(findings): ' || sqlerrm || '; '; end;
    begin v_n := ai_remark_tick(); v_res := v_res || jsonb_build_object('remarks', v_n); exception when others then v_errs := v_errs || 'remarks: ' || sqlerrm || '; '; end;
    begin v_n := to_jsonb(ai_cases_from_remarks()); v_res := v_res || jsonb_build_object('casesFromRemarks', v_n); exception when others then v_errs := v_errs || 'cases(remarks): ' || sqlerrm || '; '; end;
    begin v_n := to_jsonb(ai_draft_plans()); v_res := v_res || jsonb_build_object('plansDrafted', v_n); exception when others then v_errs := v_errs || 'plans: ' || sqlerrm || '; '; end;
    begin v_n := ai_engagement_tick(); v_res := v_res || jsonb_build_object('engagement', v_n); exception when others then v_errs := v_errs || 'engagement: ' || sqlerrm || '; '; end;
    begin v_n := to_jsonb(ai_review_plans()); v_res := v_res || jsonb_build_object('plansReviewed', v_n); exception when others then v_errs := v_errs || 'review: ' || sqlerrm || '; '; end;
    perform ai_job_finish((j->>'id')::uuid, v_errs = '', nullif(v_errs, ''), v_res);
    v_res := v_res || jsonb_build_object('ran', 'daily');
    if v_errs <> '' then v_res := v_res || jsonb_build_object('failed', v_errs); end if;
  else
    v_res := jsonb_build_object('skipped', j->>'status');
  end if;

  -- the monthly review of open activities: on the last day of the month, after the monthly time
  v_last := (local_now::date + 1) = (date_trunc('month', local_now::date + 1))::date;
  if v_last and local_now::time >= v_month_due then
    j := ai_job_begin('monthly', 'monthly:' || to_char(local_now, 'YYYY-MM'), app_now());
    if (j->>'run')::boolean then
      begin
        v_n := ai_closure_tick(date_trunc('month', local_now::date)::date);
        perform ai_job_finish((j->>'id')::uuid, true, null, v_n);
        v_res := v_res || jsonb_build_object('monthly', v_n);
      exception when others then
        perform ai_job_finish((j->>'id')::uuid, false, sqlerrm);
        v_res := v_res || jsonb_build_object('monthlyFailed', sqlerrm);
      end;
    end if;
  end if;
  return v_res;
end $$;

select lock_down_function_grants();
