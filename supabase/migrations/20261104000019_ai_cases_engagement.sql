-- 4COREPAL phase 5 (part 1): performance intelligence cases, adaptive engagement and escalation, corrective plans, and the approvals queue
-- (docs/38-4COREPAL-DESIGN.md). Additive: only ai_ objects, plus a few columns on ai_ tables that no screen reads yet.
--
-- Rules built in:
--  * A case is opened once per observation (fingerprint), with the evidence as it was then and a timeline nobody can rewrite.
--  * Who is asked follows the escalation policy (data): the unit's lead first, executives after the policy's hours with no response, a critical case both at once.
--    A response from the unit stops further escalation. Nobody is asked twice for the same step.
--  * A cause is a hypothesis unless the data confirms it. A unit's own remarks are recorded explanations, labelled as such, never confirmed causes.
--  * The agent drafts corrective plans; a person submits them; a different person with ai.approval.decide approves. Nobody approves their own proposal.
--  * A plan's effectiveness is judged on the unit's scores after it started, not on its owner ticking actions done.
--  * Nothing here changes an official goal, target, score, report or locked week.

alter table ai_cases add column responded_at timestamptz;
alter table ai_case_events add column seq bigint generated always as identity;      -- a stable order for events that share a moment, as the audit log has
alter table ai_corrective_plans add column started_at timestamptz, add column decided_by uuid references users(id), add column decided_at timestamptz, add column decision_note text;

insert into email_event_types (event_type, mandatory, description) values
  ('AI_CASE',              false, '4COREPAL: a performance case needs your unit''s response'),
  ('AI_CASE_ESCALATION',   false, '4COREPAL: a performance case was not answered'),
  ('AI_CASE_RESOLVED',     false, '4COREPAL: a performance case was resolved'),
  ('AI_APPROVAL_REQUEST',  false, '4COREPAL: a proposal needs your decision'),
  ('AI_CLOSURE_REQUEST',   false, '4COREPAL: the monthly review of open activities needs your answers'),
  ('AI_PLAN_DECIDED',      false, '4COREPAL: a corrective plan was decided');

create or replace function ai_case_log(p_case uuid, p_type text, p_actor uuid, p_agent boolean, p_detail jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into ai_case_events (case_id, event_type, actor_user_id, by_agent, detail) values (p_case, p_type, p_actor, p_agent, coalesce(p_detail, '{}'::jsonb));
$$;

-- the average final score of a unit's last p_n finalised weeks (latest calculation of each), optionally only weeks that began after p_since
create or replace function ai_unit_scores(p_bu uuid, p_since timestamptz, p_n int) returns table (score numeric, weeks int)
language sql stable security definer set search_path = public, pg_temp as $$
  select avg(x.final_score), count(*)::int from (
    select s.final_score from (select distinct on (business_unit_id, reporting_week_id) * from weekly_score_snapshots where business_unit_id = p_bu order by business_unit_id, reporting_week_id, version_number desc) s
      join reporting_weeks w on w.id = s.reporting_week_id and w.status = 'FINAL_LOCKED' and w.reporting_state = 'NORMAL'
     where s.final_score is not null and (p_since is null or w.week_start_at >= p_since) order by w.week_start_at desc limit p_n) x;
$$;

-- ------------------------------------------------------------------ opening a case
create or replace function ai_open_case(p_fingerprint text, p_title text, p_category text, p_description text, p_bu uuid, p_severity text, p_assessment text, p_hypotheses jsonb,
                                         p_recommendation text, p_evidence jsonb, p_finding uuid default null, p_goal uuid default null, p_task uuid default null, p_actor uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; e jsonb;
begin
  if p_actor is not null then perform require_permission(p_actor, 'ai.case.manage');
  elsif ai_action_mode('OPEN_CASE') is distinct from 'AUTO' then return null; end if;
  if p_fingerprint is not null then select id into v_id from ai_cases where fingerprint = p_fingerprint; if found then return v_id; end if; end if;
  insert into ai_cases (title, category, description, business_unit_id, smart_goal_id, task_id, finding_id, fingerprint, severity, risk_level, assessment, hypotheses, recommendation, created_by, created_by_agent)
  values (left(p_title, 300), p_category, left(coalesce(p_description, ''), 8000), p_bu, p_goal, p_task, p_finding, p_fingerprint, p_severity, p_severity, left(coalesce(p_assessment, ''), 8000),
          coalesce(p_hypotheses, '[]'::jsonb), left(coalesce(p_recommendation, ''), 8000), p_actor, p_actor is null) returning id into v_id;
  for e in select * from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) loop
    insert into ai_case_evidence (case_id, kind, ref_table, ref_id, reporting_week_id, summary, captured_value)
    values (v_id, coalesce(e->>'kind', 'OTHER'), e->>'ref_table', e->>'ref_id', nullif(e->>'reporting_week_id', '')::uuid, left(coalesce(e->>'summary', ''), 2000), e->'value');
  end loop;
  perform ai_case_log(v_id, 'CREATED', p_actor, p_actor is null, jsonb_build_object('severity', p_severity, 'category', p_category));
  perform write_audit(p_actor, 'AI_CASE_OPENED', 'ai_case', v_id::text, null, jsonb_build_object('category', p_category, 'severity', p_severity, 'by_agent', p_actor is null), null, p_bu);
  return v_id;
end $$;

-- A high or critical finding becomes a case. What the unit itself said about that week's tasks is attached as explanation to check, never as a confirmed cause.
create or replace function ai_cases_from_findings() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare f record; v_id uuid; v_n int := 0; v_hyp jsonb; v_cat text; v_rec text;
begin
  if ai_action_mode('OPEN_CASE') is distinct from 'AUTO' then return 0; end if;
  for f in select * from ai_findings where state = 'NEW' and severity in ('HIGH', 'CRITICAL') order by detected_at loop
    v_cat := case f.kind when 'CONSECUTIVE_MISSED_REPORTS' then 'REPORTING_NON_COMPLIANCE' when 'SCORE_DROP' then 'UNDERPERFORMING_BU' else 'OTHER' end;
    v_rec := case f.kind when 'CONSECUTIVE_MISSED_REPORTS' then 'Ask the unit lead why no report was filed in consecutive weeks, and agree who files and by when.'
                         when 'SCORE_DROP' then 'Ask the unit lead what changed between the two weeks, and review the tasks that were not done and the reasons given.' else 'Review the finding with the unit.' end;
    select coalesce(jsonb_agg(jsonb_build_object('text', format('The unit recorded "%s" as the reason for %s task%s that week.', r.reason_code, r.n, case when r.n = 1 then '' else 's' end), 'status', 'HYPOTHESIS',
             'basis', 'the unit''s own remark; not verified')), '[]'::jsonb) into v_hyp
      from (select m.reason_code, count(*) n from ai_task_remarks m join ai_remark_requests q on q.id = m.request_id where q.business_unit_id = f.business_unit_id and q.reporting_week_id = f.reporting_week_id group by m.reason_code) r;
    v_id := ai_open_case('finding:' || f.id, initcap(replace(lower(f.kind), '_', ' ')) || ': ' || coalesce((select name from business_units where id = f.business_unit_id), 'organisation'), v_cat, f.summary, f.business_unit_id, f.severity,
      'Detected by the daily review from the recorded weekly results. ' || f.summary, v_hyp, v_rec,
      jsonb_build_array(jsonb_build_object('kind', case when f.kind = 'SCORE_DROP' then 'SCORE' else 'WEEKLY_REPORT' end, 'ref_table', 'ai_findings', 'ref_id', f.id::text, 'reporting_week_id', f.reporting_week_id, 'summary', f.summary, 'value', f.evidence)), f.id);
    if v_id is not null then update ai_findings set state = 'CASE_OPENED', updated_at = app_now() where id = f.id; v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- Several recent remarks of the same kind in one unit are a pattern worth a case. It is stated as the unit's own account.
create or replace function ai_cases_from_remarks() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_id uuid; v_n int := 0; v_cat text; v_fp text; v_existed boolean;
begin
  if ai_action_mode('OPEN_CASE') is distinct from 'AUTO' then return 0; end if;
  for r in select m.business_unit_id, m.reason_code, count(*)::int n, b.name unit_name, to_char(app_now(), 'YYYY-MM') ym, array_agg(m.task_id) tasks
             from ai_task_remarks m join business_units b on b.id = m.business_unit_id
            where m.reason_code in ('RESOURCES', 'DEPENDENCY') and m.created_at >= app_now() - interval '28 days' group by m.business_unit_id, m.reason_code, b.name having count(*) >= 3 loop
    v_cat := case r.reason_code when 'RESOURCES' then 'RESOURCE_CONSTRAINT' else 'CROSS_BU_DEPENDENCY' end;
    v_fp := 'remarks:' || r.reason_code || ':' || r.business_unit_id || ':' || r.ym;
    v_existed := exists (select 1 from ai_cases where fingerprint = v_fp);
    v_id := ai_open_case(v_fp,
      case r.reason_code when 'RESOURCES' then r.unit_name || ': tasks missed for lack of resources' else r.unit_name || ': tasks waiting on other units' end, v_cat,
      format('%s gave "%s" as the reason for %s tasks not done in the last four weeks.', r.unit_name, r.reason_code, r.n), r.business_unit_id, 'MEDIUM',
      'A recurring reason in the unit''s own remarks. It is the unit''s account of what happened and has not been verified against anything else.',
      jsonb_build_array(jsonb_build_object('text', case r.reason_code when 'RESOURCES' then 'The unit may be short of people, time or budget for what it commits to.' else 'The unit may depend on another unit that is not delivering in time.' end,
                                           'status', 'HYPOTHESIS', 'basis', format('%s remarks by the unit', r.n))),
      case r.reason_code when 'RESOURCES' then 'Ask what is missing and whether commitments should be reduced or support provided.' else 'Identify which unit is depended on and agree the hand-over dates with both.' end,
      (select jsonb_agg(jsonb_build_object('kind', 'REMARK', 'ref_table', 'tasks', 'ref_id', t::text, 'summary', 'Task with a remark of ' || r.reason_code)) from unnest(r.tasks) t));
    if v_id is not null and not v_existed then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- ------------------------------------------------------------------ who is asked, and when
create or replace function ai_engagement_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c record; p record; nxt int; u uuid; ids uuid[]; v_key text; v_title text; v_msg text; v_ev text; v_nid uuid; v_asked int := 0; v_escalated int := 0; v_status text;
begin
  if ai_action_mode('REQUEST_EXPLANATION') is distinct from 'AUTO' then return jsonb_build_object('skipped', 'request_explanation is not automatic'); end if;
  for c in select ca.*, b.name unit_name from ai_cases ca left join business_units b on b.id = ca.business_unit_id
            where ca.status in ('OPEN', 'AWAITING_RESPONSE', 'ESCALATED', 'INTERVENTION_REQUIRED') and ca.responded_at is null order by ca.detected_at loop
    for p in select * from ai_escalation_policies where severity = c.severity order by step loop
      continue when app_now() < c.detected_at + make_interval(hours => p.after_hours);
      continue when exists (select 1 from ai_case_events ev where ev.case_id = c.id and ev.event_type in ('COMMUNICATION', 'ESCALATION') and (ev.detail->>'step')::int = p.step);
      ids := case p.audience
        when 'BU_LEAD' then coalesce(array(select ai_remark_recipients(c.business_unit_id) where c.business_unit_id is not null), '{}')
        when 'AFFECTED_BU_LEADS' then coalesce(array(select ai_remark_recipients(x) from (values (c.business_unit_id), (c.assigned_bu_id)) v(x) where x is not null), '{}')
        else coalesce(array(select ai_executive_recipients()), '{}') end;
      v_ev := case when p.audience = 'EXECUTIVES' then 'ESCALATION' else 'COMMUNICATION' end;
      v_title := case when p.audience = 'EXECUTIVES' then format('%s needs executive attention', c.reference) else format('%s needs your response', c.reference) end;
      v_msg := format('%s: %s. %s Open 4COREPAL, then Cases, to %s.', c.reference, c.title, left(c.description, 300), case when p.audience = 'EXECUTIVES' then 'review it' else 'respond' end);
      foreach u in array ids loop
        v_key := 'aicase:' || c.id || ':' || p.step || ':' || u;
        perform notify_users(array[u], case when p.audience = 'EXECUTIVES' then 'AI_CASE_ESCALATION' else 'AI_CASE' end, 'ai_case', c.id::text, v_title, v_msg, v_key);
        select id into v_nid from notifications where user_id = u and dedupe_key = v_key;
        insert into ai_communications (recipient_user_id, channel, kind, subject, body, case_id, business_unit_id, notification_id, delivery_status, follow_up_status, dedupe_key)
        values (u, 'IN_APP', case when p.audience = 'EXECUTIVES' then 'ESCALATION' else 'ALERT' end, v_title, v_msg, c.id, c.business_unit_id, v_nid, 'SENT', case when p.audience = 'EXECUTIVES' then 'NONE' else 'PENDING' end, v_key) on conflict do nothing;
      end loop;
      perform ai_case_log(c.id, v_ev, null, true, jsonb_build_object('step', p.step, 'audience', p.audience, 'recipients', coalesce(array_length(ids, 1), 0)));
      select min(step) into nxt from ai_escalation_policies where severity = c.severity and step > p.step;
      v_status := case when p.audience = 'EXECUTIVES' then 'ESCALATED' else 'AWAITING_RESPONSE' end;
      update ai_cases set status = case when status = 'ESCALATED' then status else v_status end,
        response_due_at = c.detected_at + make_interval(hours => coalesce((select after_hours from ai_escalation_policies where severity = c.severity and step = nxt), p.after_hours + 168)), updated_at = app_now()
       where id = c.id;
      if p.audience = 'EXECUTIVES' then v_escalated := v_escalated + 1; else v_asked := v_asked + 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('asked', v_asked, 'escalated', v_escalated);
end $$;

-- the unit's answer to a case: recorded as said, stops further escalation, and moves the case to investigation
create or replace function ai_respond_case(p_actor uuid, p_case uuid, p_text text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c ai_cases; v_text text := btrim(coalesce(p_text, ''));
begin
  perform require_permission(p_actor, 'ai.remark.submit');
  select * into c from ai_cases where id = p_case for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if actor_bu(p_actor) is distinct from c.business_unit_id and actor_bu(p_actor) is distinct from c.assigned_bu_id then raise exception 'BU_SCOPE_DENIED'; end if;
  if c.status in ('RESOLVED', 'CLOSED') then raise exception 'INVALID_STATE_TRANSITION'; end if;
  if v_text = '' or char_length(v_text) > 4000 then raise exception 'VALIDATION_ERROR' using detail = 'write your response in up to 4000 characters'; end if;
  perform ai_case_log(p_case, 'RESPONSE', p_actor, false, jsonb_build_object('text', v_text));
  update ai_cases set responded_at = coalesce(responded_at, app_now()), status = case when status in ('OPEN', 'AWAITING_RESPONSE', 'ESCALATED') then 'UNDER_INVESTIGATION' else status end, updated_at = app_now() where id = p_case;
  update ai_communications set acknowledged_at = coalesce(acknowledged_at, app_now()), responded_at = app_now(), response = left(v_text, 4000), follow_up_status = 'DONE' where case_id = p_case and recipient_user_id = p_actor;
  update ai_communications set follow_up_status = 'DONE' where case_id = p_case and follow_up_status = 'PENDING';
  perform write_audit(p_actor, 'AI_CASE_RESPONDED', 'ai_case', p_case::text, null, jsonb_build_object('length', char_length(v_text)), null, c.business_unit_id);
end $$;

-- the people who manage cases move them along; a case is resolved with a written resolution and closed afterwards
create or replace function ai_case_update(p_actor uuid, p_case uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c ai_cases; v_note text := btrim(coalesce(p_note, '')); u uuid;
begin
  perform require_permission(p_actor, 'ai.case.manage');
  select * into c from ai_cases where id = p_case for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_status not in ('UNDER_INVESTIGATION', 'AWAITING_RESPONSE', 'INTERVENTION_REQUIRED', 'CORRECTIVE_ACTION_IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED') then raise exception 'VALIDATION_ERROR' using detail = 'unknown status'; end if;
  if c.status = 'CLOSED' then raise exception 'INVALID_STATE_TRANSITION'; end if;
  if p_status = 'CLOSED' and c.status <> 'RESOLVED' then raise exception 'INVALID_STATE_TRANSITION'; end if;
  if p_status = 'RESOLVED' and (v_note = '' or char_length(v_note) > 8000) then raise exception 'VALIDATION_ERROR' using detail = 'write how the case was resolved'; end if;
  update ai_cases set status = p_status, updated_at = app_now(),
    resolution = case when p_status = 'RESOLVED' then v_note else resolution end, closed_at = case when p_status in ('RESOLVED', 'CLOSED') then coalesce(closed_at, app_now()) else null end where id = p_case;
  perform ai_case_log(p_case, 'STATUS_CHANGE', p_actor, false, jsonb_build_object('from', c.status, 'to', p_status, 'note', left(v_note, 2000)));
  perform write_audit(p_actor, 'AI_CASE_' || p_status, 'ai_case', p_case::text, jsonb_build_object('status', c.status), jsonb_build_object('status', p_status), left(v_note, 500), c.business_unit_id);
  if p_status = 'RESOLVED' and c.business_unit_id is not null then
    foreach u in array coalesce(array(select ai_remark_recipients(c.business_unit_id)), '{}') loop
      perform notify_users(array[u], 'AI_CASE_RESOLVED', 'ai_case', p_case::text, c.reference || ' was resolved', c.reference || ': ' || c.title || '. Resolution: ' || left(v_note, 400), 'aires:' || p_case || ':' || u);
    end loop;
  end if;
end $$;

create or replace function ai_case_note(p_actor uuid, p_case uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_note text := btrim(coalesce(p_note, ''));
begin
  perform require_permission(p_actor, 'ai.case.manage');
  if not exists (select 1 from ai_cases where id = p_case) then raise exception 'NOT_FOUND'; end if;
  if v_note = '' or char_length(v_note) > 4000 then raise exception 'VALIDATION_ERROR' using detail = 'write a note of up to 4000 characters'; end if;
  perform ai_case_log(p_case, 'NOTE', p_actor, false, jsonb_build_object('text', v_note));
end $$;

-- ------------------------------------------------------------------ corrective plans
-- The agent drafts (nothing is assigned by a draft). A person with ai.action.assign submits it; a different person with ai.approval.decide approves it.
create or replace function ai_draft_corrective_plan(p_case uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c ai_cases; v_id uuid; v_base numeric; v_intervention text; v_remarks text;
begin
  select * into c from ai_cases where id = p_case;
  if not found or c.business_unit_id is null or c.severity not in ('HIGH', 'CRITICAL') then return null; end if;
  if exists (select 1 from ai_corrective_plans where case_id = p_case and status in ('DRAFT', 'PROPOSED', 'APPROVED', 'IN_PROGRESS')) then return null; end if;
  select score into v_base from ai_unit_scores(c.business_unit_id, null, 3);
  select string_agg(reason_code || ' (' || n || ')', ', ') into v_remarks from (select m.reason_code, count(*) n from ai_task_remarks m where m.business_unit_id = c.business_unit_id group by 1 order by 2 desc limit 3) x;
  v_intervention := case c.category
    when 'REPORTING_NON_COMPLIANCE' then 'Agree a named person and a fixed weekday for filing the weekly report; the unit lead confirms in writing.'
    when 'UNDERPERFORMING_BU' then 'Hold a review with the unit lead of the weeks that scored low: which tasks were not done, why, and what will change in the next three weeks.'
    when 'RESOURCE_CONSTRAINT' then 'Agree what the unit is short of and either reduce its weekly commitments or provide the resource.'
    when 'CROSS_BU_DEPENDENCY' then 'Agree hand-over dates with the unit depended on and record them in both units'' weekly goals.'
    else 'Review the case with the unit lead and agree specific actions with dates.' end;
  insert into ai_corrective_plans (case_id, problem, evidence, root_cause_assessment, intervention, expected_outcome, owner_bu_id, target_date, success_measure, review_date, baseline_score, created_by_agent)
  values (p_case, left(c.title || '. ' || c.description, 4000), left(c.assessment, 4000),
    'Not established. ' || coalesce('The unit''s own most common reasons: ' || v_remarks || '. These are its account and have not been verified.', 'The unit has not yet given reasons.'),
    v_intervention, 'The unit''s weekly score recovers to the 70% quarter target or better.', c.business_unit_id, (app_now() + interval '28 days')::date,
    'Average weekly score of the next finalised weeks at or above the baseline plus 5 points, or at least 70%.', (app_now() + interval '35 days')::date, round(v_base, 2), true) returning id into v_id;
  perform ai_case_log(p_case, 'ACTION', null, true, jsonb_build_object('plan', v_id, 'status', 'DRAFT'));
  return v_id;
end $$;

create or replace function ai_submit_plan(p_actor uuid, p_plan uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare p ai_corrective_plans; v_appr uuid; u uuid;
begin
  perform require_permission(p_actor, 'ai.action.assign');
  select * into p from ai_corrective_plans where id = p_plan for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p.status <> 'DRAFT' then raise exception 'INVALID_STATE_TRANSITION'; end if;
  if not exists (select 1 from ai_corrective_actions where plan_id = p_plan) then raise exception 'VALIDATION_ERROR' using detail = 'add at least one action before submitting the plan'; end if;
  if (select mode from ai_action_policies where action_type = 'CREATE_CORRECTIVE_ACTION') = 'DISABLED' then raise exception 'VALIDATION_ERROR' using detail = 'corrective actions are switched off'; end if;
  insert into ai_approvals (action_type, subject_type, subject_id, proposal, case_id, requested_by, by_agent)
  values ('CREATE_CORRECTIVE_ACTION', 'corrective_plan', p_plan::text, jsonb_build_object('intervention', p.intervention, 'owner_bu_id', p.owner_bu_id, 'target_date', p.target_date), p.case_id, p_actor, false) returning id into v_appr;
  update ai_corrective_plans set status = 'PROPOSED', updated_at = app_now() where id = p_plan;
  perform ai_case_log(p.case_id, 'APPROVAL', p_actor, false, jsonb_build_object('plan', p_plan, 'approval', v_appr, 'status', 'PROPOSED'));
  foreach u in array coalesce(array(select u2.id from users u2 where u2.status = 'ACTIVE' and actor_has_permission(u2.id, 'ai.approval.decide') and u2.id <> p_actor), '{}') loop
    perform notify_users(array[u], 'AI_APPROVAL_REQUEST', 'ai_approval', v_appr::text, 'A corrective plan needs your decision', left(p.intervention, 300) || ' Open 4COREPAL, then Approvals.', 'aiappr:' || v_appr || ':' || u);
  end loop;
  perform write_audit(p_actor, 'AI_PLAN_SUBMITTED', 'ai_corrective_plan', p_plan::text, null, jsonb_build_object('approval', v_appr), null, p.owner_bu_id);
  return v_appr;
end $$;

create or replace function ai_add_corrective_action(p_actor uuid, p_plan uuid, p_description text, p_owner_bu uuid, p_due date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare p ai_corrective_plans; v_id uuid;
begin
  perform require_permission(p_actor, 'ai.action.assign');
  select * into p from ai_corrective_plans where id = p_plan;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p.status not in ('DRAFT', 'IN_PROGRESS') then raise exception 'INVALID_STATE_TRANSITION'; end if;
  if btrim(coalesce(p_description, '')) = '' or char_length(p_description) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'describe the action in up to 2000 characters'; end if;
  insert into ai_corrective_actions (plan_id, description, owner_bu_id, due_date) values (p_plan, btrim(p_description), coalesce(p_owner_bu, p.owner_bu_id), p_due) returning id into v_id;
  perform ai_case_log(p.case_id, 'ACTION', p_actor, false, jsonb_build_object('plan', p_plan, 'action', v_id, 'added', true));
  return v_id;
end $$;

-- the unit marks its action done or blocked (a note is required to say why it is blocked); managers may also cancel
create or replace function ai_set_action_status(p_actor uuid, p_action uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a ai_corrective_actions; p ai_corrective_plans; v_note text := btrim(coalesce(p_note, ''));
begin
  select * into a from ai_corrective_actions where id = p_action for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into p from ai_corrective_plans where id = a.plan_id;
  if p_status not in ('DONE', 'BLOCKED', 'OPEN', 'CANCELLED') then raise exception 'VALIDATION_ERROR' using detail = 'unknown status'; end if;
  if p.status <> 'IN_PROGRESS' then raise exception 'INVALID_STATE_TRANSITION'; end if;
  if p_status = 'CANCELLED' then perform require_permission(p_actor, 'ai.action.assign');
  else
    perform require_permission(p_actor, 'ai.remark.submit');
    if actor_bu(p_actor) is distinct from a.owner_bu_id then raise exception 'BU_SCOPE_DENIED'; end if;
  end if;
  if p_status = 'BLOCKED' and v_note = '' then raise exception 'VALIDATION_ERROR' using detail = 'say what is blocking the action'; end if;
  update ai_corrective_actions set status = p_status, note = nullif(left(v_note, 2000), ''), completed_at = case when p_status = 'DONE' then app_now() else null end where id = p_action;
  perform ai_case_log(p.case_id, 'ACTION', p_actor, false, jsonb_build_object('plan', p.id, 'action', p_action, 'status', p_status, 'note', left(v_note, 500)));
  perform write_audit(p_actor, 'AI_ACTION_' || p_status, 'ai_corrective_action', p_action::text, jsonb_build_object('status', a.status), jsonb_build_object('status', p_status), left(v_note, 500), a.owner_bu_id);
end $$;

-- ------------------------------------------------------------------ the approvals queue (corrective plans now; dispositions in the next migration)
create or replace function ai_decide_approval(p_actor uuid, p_approval uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare a ai_approvals; p ai_corrective_plans; d ai_dispositions; v_note text := btrim(coalesce(p_note, '')); u uuid;
begin
  perform require_permission(p_actor, 'ai.approval.decide');
  select * into a from ai_approvals where id = p_approval for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if a.status <> 'PENDING' then raise exception 'INVALID_STATE_TRANSITION'; end if;
  if a.requested_by is not null and a.requested_by = p_actor then raise exception 'SEPARATION_OF_DUTIES'; end if;
  if not p_approve and v_note = '' then raise exception 'VALIDATION_ERROR' using detail = 'give a reason when you reject'; end if;
  update ai_approvals set status = case when p_approve then 'APPROVED' else 'REJECTED' end, decided_by = p_actor, decided_at = app_now(), decision_note = nullif(left(v_note, 2000), '') where id = p_approval;
  if a.subject_type = 'corrective_plan' then
    select * into p from ai_corrective_plans where id = a.subject_id::uuid for update;
    update ai_corrective_plans set status = case when p_approve then 'IN_PROGRESS' else 'REJECTED' end, decided_by = p_actor, decided_at = app_now(), decision_note = nullif(left(v_note, 2000), ''),
      started_at = case when p_approve then app_now() else null end, updated_at = app_now() where id = p.id;
    perform ai_case_log(p.case_id, 'APPROVAL', p_actor, false, jsonb_build_object('plan', p.id, 'approval', p_approval, 'status', case when p_approve then 'APPROVED' else 'REJECTED' end, 'note', left(v_note, 500)));
    if p_approve then update ai_cases set status = 'CORRECTIVE_ACTION_IN_PROGRESS', updated_at = app_now() where id = p.case_id and status not in ('RESOLVED', 'CLOSED'); end if;
    foreach u in array coalesce(array(select ai_remark_recipients(p.owner_bu_id) where p.owner_bu_id is not null), '{}') loop
      perform notify_users(array[u], 'AI_PLAN_DECIDED', 'ai_corrective_plan', p.id::text, case when p_approve then 'A corrective plan for your unit was approved' else 'A corrective plan for your unit was not approved' end,
        left(p.intervention, 300) || case when p_approve then ' Open 4COREPAL, then Cases, to see your actions.' else ' Reason: ' || left(v_note, 300) end, 'aiplan:' || p.id || ':' || u);
    end loop;
  elsif a.subject_type = 'disposition' then
    select * into d from ai_dispositions where id = a.subject_id::uuid for update;
    update ai_dispositions set status = case when p_approve then 'APPROVED' else 'REJECTED' end, decided_by = p_actor, decided_at = app_now(), decision_note = nullif(left(v_note, 2000), '') where id = d.id;
    if d.case_id is not null then perform ai_case_log(d.case_id, 'APPROVAL', p_actor, false, jsonb_build_object('disposition', d.id, 'status', case when p_approve then 'APPROVED' else 'REJECTED' end)); end if;
  end if;
  perform write_audit(p_actor, case when p_approve then 'AI_APPROVAL_APPROVED' else 'AI_APPROVAL_REJECTED' end, 'ai_approval', p_approval::text, null, jsonb_build_object('subject', a.subject_type, 'subject_id', a.subject_id), left(v_note, 500));
  return case when p_approve then 'APPROVED' else 'REJECTED' end;
end $$;

-- A plan is judged by what the unit's scores did after it started: at least two finalised weeks are needed, and the verdict is never "improved" because actions were ticked.
create or replace function ai_review_plans() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare p record; s record; v_eff text; v_n int := 0;
begin
  for p in select * from ai_corrective_plans where status = 'IN_PROGRESS' and effectiveness is null and review_date <= app_now()::date and started_at is not null loop
    select * into s from ai_unit_scores(p.owner_bu_id, p.started_at, 6);
    if coalesce(s.weeks, 0) < 2 and p.review_date + 28 > app_now()::date then continue; end if;
    v_eff := case when coalesce(s.weeks, 0) < 2 or p.baseline_score is null then 'INSUFFICIENT_DATA' when s.score - p.baseline_score >= 5 then 'IMPROVED' when s.score - p.baseline_score <= -5 then 'WORSE' else 'NO_CHANGE' end;
    update ai_corrective_plans set effectiveness = v_eff, review_score = round(s.score, 2), status = 'COMPLETED', updated_at = app_now() where id = p.id;
    perform ai_case_log(p.case_id, 'ACTION', null, true, jsonb_build_object('plan', p.id, 'review', v_eff, 'baseline', p.baseline_score, 'review_score', round(s.score, 2), 'weeks', s.weeks));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

select lock_down_function_grants();
