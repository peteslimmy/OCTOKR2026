-- Audit & Security Centre, part 2 of 2: detection rules, alerts, and the read functions of the Centre (ADR-112..ADR-113).
-- An alert is an INDICATOR for review ("these events matched this pattern"), never a finding about a person. Every status change is itself audited.

-- ------------------------------------------------------------------ rules (data, so thresholds are configurable without a deploy)
create table audit_detection_rules (
  code            text primary key check (code ~ '^[A-Z][A-Z0-9_]{2,59}$'),
  name            text not null,
  description     text not null,
  enabled         boolean not null default true,
  severity        text not null check (severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  threshold       int  not null check (threshold between 1 and 100000),
  window_minutes  int  not null check (window_minutes between 1 and 43200),
  group_by        text not null check (group_by in ('ACTOR','ENTITY','IP','NONE')),
  match_actions   text[] not null,                 -- LIKE patterns on the action code
  match_outcomes  text[],
  params          jsonb not null default '{}'::jsonb,   -- self_target: bool; new_values_like: text; actor_role_like: text; off_hours: [fromHourWAT, toHourWAT]
  updated_by      uuid,
  updated_at      timestamptz not null default app_now()
);
insert into audit_detection_rules (code, name, description, severity, threshold, window_minutes, group_by, match_actions, match_outcomes, params) values
  ('REPEATED_FAILED_LOGINS', 'Repeated failed sign-ins', 'Several failed sign-in attempts against one account in a short time.', 'HIGH', 5, 15, 'ENTITY', array['AUTH\_LOGIN\_FAILED','AUTH\_ACCOUNT\_LOCKED'], null, '{}'),
  ('REPEATED_DENIALS', 'Repeated access denials', 'One person was refused several times (permission, scope or sign-in) in a short time.', 'MEDIUM', 5, 30, 'ACTOR', array['ACCESS\_DENIED','SECURITY\_AUTH\_REQUIRED','SECURITY\_MFA\_%'], null, '{}'),
  ('PRIVILEGE_ESCALATION', 'Administrator role granted', 'A role change that gives a person an administrator role.', 'HIGH', 1, 60, 'ENTITY', array['USER\_ROLES\_CHANGED'], null, '{"new_values_like":"%ADMIN%"}'),
  ('SELF_ROLE_CHANGE', 'Own roles changed', 'A person changed their own roles.', 'CRITICAL', 1, 60, 'ACTOR', array['USER\_ROLES\_CHANGED'], null, '{"self_target":true}'),
  ('SENSITIVE_ROLE_CHANGE', 'Role or permission definition changed', 'A role was created, edited or deleted, or a permission was granted or removed.', 'MEDIUM', 1, 60, 'ACTOR', array['ROLE\_%','PERMISSION\_%'], null, '{}'),
  ('SUPER_ADMIN_ACTIVITY', 'Unusual Super Admin activity', 'A Super Admin account produced many events in an hour.', 'MEDIUM', 60, 60, 'ACTOR', array['%'], null, '{"actor_role_like":"%SUPER\\_ADMIN%","exclude_actions":["AUDIT\\_%","ACCESS\\_DENIED"]}'),
  ('SUPER_ADMIN_OFF_HOURS', 'Super Admin activity outside working hours', 'Several Super Admin events between 22:00 and 05:00 (WAT).', 'MEDIUM', 5, 480, 'ACTOR', array['%'], null, '{"actor_role_like":"%SUPER\\_ADMIN%","off_hours":[22,5],"exclude_actions":["AUDIT\\_%","AUTH\\_%"]}'),
  ('SCHEDULE_OR_LOCK_CHANGE', 'Reporting schedule or lock changed', 'The reporting schedule was changed, or week locks were suspended or restored.', 'MEDIUM', 1, 60, 'NONE', array['LOCK\_SCHEDULE%','REPORTING\_WEEK\_LOCKS%','REPORTING\_SCHEDULE%','REPORTING\_WEEK\_FINAL%'], null, '{}'),
  ('UNUSUAL_EXPORTS', 'Many exports in a short time', 'One person exported or downloaded many files or registers in an hour.', 'MEDIUM', 5, 60, 'ACTOR', array['%EXPORT%','FILE\_DOWNLOADED'], null, '{}'),
  ('INTEGRITY_FAILURES', 'Integrity correction or chain failure', 'A data-integrity correction was made, an integrity operation failed, or the audit chain failed verification.', 'HIGH', 1, 60, 'ENTITY', array['INTEGRITY\_%','SESSION\_CORRECTION\_EMERGENCY','AUDIT\_CHAIN\_BROKEN','QUARTER\_SCORE\_AMENDED'], null, '{}');
alter table audit_detection_rules enable row level security;
create policy read_rules on audit_detection_rules for select to authenticated using ((select auth_has_permission('audit.read')));
grant select on audit_detection_rules to authenticated, service_role;

create table audit_alerts (
  id                 uuid primary key default gen_random_uuid(),
  rule_code          text not null references audit_detection_rules(code),
  severity           text not null,
  group_key          text not null,
  subject_user_id    uuid,
  subject_label      text,
  event_count        int not null,
  first_event_at     timestamptz not null,
  last_event_at      timestamptz not null,
  evidence_event_ids uuid[] not null,
  summary            text not null,
  status             text not null default 'NEW' check (status in ('NEW','UNDER_REVIEW','EXPLAINED','ESCALATED','DISMISSED')),
  status_note        text,
  status_by          uuid,
  status_at          timestamptz,
  created_at         timestamptz not null default app_now()
);
create index audit_alerts_open_idx on audit_alerts (status, created_at desc);
create index audit_alerts_rule_idx on audit_alerts (rule_code, group_key, created_at desc);
alter table audit_alerts enable row level security;
create policy read_alerts on audit_alerts for select to authenticated using ((select auth_has_permission('audit.read')));
grant select on audit_alerts to authenticated, service_role;

-- ------------------------------------------------------------------ evaluation (run by the scheduler; also callable by the service on demand)
create or replace function audit_run_detection() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r audit_detection_rules; g record; v_raised int := 0; v_id uuid; v_hour int;
begin
  for r in select * from audit_detection_rules where enabled loop
    for g in
      select case r.group_by when 'ACTOR' then coalesce(a.actor_user_id::text, '-') when 'ENTITY' then a.entity_type || ':' || coalesce(a.entity_id, '')
                             when 'IP' then coalesce(a.ip_address, '-') else 'all' end as gk,
             (array_agg(a.actor_user_id order by a.seq))[1] as actor, (array_agg(a.actor_name order by a.seq))[1] as nm, (array_agg(a.entity_id order by a.seq))[1] as eid,
             count(*)::int as n, (array_agg(a.id order by a.seq desc))[1:50] as ids, min(a.occurred_at) as t0, max(a.occurred_at) as t1
        from audit_logs a
       where a.occurred_at >= app_now() - make_interval(mins => r.window_minutes)
         and exists (select 1 from unnest(r.match_actions) p where a.action like p)
         and (r.params->'exclude_actions' is null or not exists (select 1 from jsonb_array_elements_text(r.params->'exclude_actions') x where a.action like x))
         and (r.match_outcomes is null or a.outcome = any (r.match_outcomes))
         and (coalesce(r.params->>'self_target', 'false') <> 'true' or a.actor_user_id::text = a.entity_id)
         and (r.params->>'new_values_like' is null or a.new_values::text ilike (r.params->>'new_values_like'))
         and (r.params->>'actor_role_like' is null or a.actor_role like (r.params->>'actor_role_like'))
         and (r.params->'off_hours' is null or (
               extract(hour from a.occurred_at at time zone 'Africa/Lagos')::int >= (r.params->'off_hours'->>0)::int
               or extract(hour from a.occurred_at at time zone 'Africa/Lagos')::int < (r.params->'off_hours'->>1)::int))
       group by 1 having count(*) >= r.threshold
    loop
      continue when exists (select 1 from audit_alerts x where x.rule_code = r.code and x.group_key = g.gk and x.created_at > app_now() - make_interval(mins => r.window_minutes)
                              and (x.evidence_event_ids && g.ids));
      insert into audit_alerts (rule_code, severity, group_key, subject_user_id, subject_label, event_count, first_event_at, last_event_at, evidence_event_ids, summary)
      values (r.code, r.severity, g.gk, case when r.group_by = 'ACTOR' then g.actor end, case when r.group_by = 'ACTOR' then g.nm else g.eid end, g.n, g.t0, g.t1, g.ids,
              format('Indicator: %s matching event(s) for "%s" within %s minutes. This is a signal to review, not a finding about anyone.', g.n, r.name, r.window_minutes))
      returning id into v_id;
      perform write_audit(null, 'AUDIT_ALERT_RAISED', 'audit_alert', v_id::text, null, jsonb_build_object('rule', r.code, 'events', g.n, 'severity', r.severity));
      perform notify_users(users_with_permission('audit.alerts.manage'), 'AUDIT_ALERT', 'audit_alert', v_id::text,
        'Security indicator: ' || r.name, format('%s event(s) matched the rule within %s minutes. Open the Audit & Security Centre to review. This is an indicator, not a conclusion.', g.n, r.window_minutes),
        'audit_alert:' || v_id::text);
      v_raised := v_raised + 1;
    end loop;
  end loop;
  return v_raised;
end $$;

create or replace function audit_alert_set_status(p_actor uuid, p_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a audit_alerts;
begin
  perform require_permission(p_actor, 'audit.alerts.manage');
  if p_status not in ('UNDER_REVIEW','EXPLAINED','ESCALATED','DISMISSED') then raise exception 'VALIDATION_ERROR' using detail = 'status'; end if;
  if p_status in ('EXPLAINED','DISMISSED','ESCALATED') and btrim(coalesce(p_note, '')) = '' then raise exception 'REASON_REQUIRED'; end if;
  select * into a from audit_alerts where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update audit_alerts set status = p_status, status_note = nullif(btrim(coalesce(p_note, '')), ''), status_by = p_actor, status_at = app_now() where id = p_id;
  perform write_audit(p_actor, 'AUDIT_ALERT_STATUS_CHANGED', 'audit_alert', p_id::text, jsonb_build_object('status', a.status), jsonb_build_object('status', p_status, 'rule', a.rule_code), nullif(btrim(coalesce(p_note, '')), ''));
end $$;

create or replace function audit_rule_configure(p_actor uuid, p_code text, p_enabled boolean, p_threshold int, p_window int, p_severity text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r audit_detection_rules;
begin
  perform require_permission(p_actor, 'audit.rules.configure');
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'REASON_REQUIRED'; end if;
  select * into r from audit_detection_rules where code = p_code for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update audit_detection_rules set enabled = coalesce(p_enabled, enabled), threshold = coalesce(p_threshold, threshold), window_minutes = coalesce(p_window, window_minutes),
         severity = coalesce(p_severity, severity), updated_by = p_actor, updated_at = app_now() where code = p_code;
  perform write_audit(p_actor, 'AUDIT_RULE_CHANGED', 'audit_detection_rule', p_code,
    jsonb_build_object('enabled', r.enabled, 'threshold', r.threshold, 'window_minutes', r.window_minutes, 'severity', r.severity),
    jsonb_build_object('enabled', coalesce(p_enabled, r.enabled), 'threshold', coalesce(p_threshold, r.threshold), 'window_minutes', coalesce(p_window, r.window_minutes), 'severity', coalesce(p_severity, r.severity)),
    btrim(p_reason));
end $$;

-- ------------------------------------------------------------------ reads of the Centre (service role; the caller's permission is re-checked here)
create or replace function audit_centre_kpis(p_actor uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  perform require_permission(p_actor, 'audit.read');
  select jsonb_build_object(
    'total', count(*), 'failed_or_denied', count(*) filter (where outcome in ('FAILURE','DENIED','REJECTED')),
    'denied', count(*) filter (where outcome = 'DENIED'), 'failures', count(*) filter (where outcome = 'FAILURE'),
    'high_or_critical', count(*) filter (where severity in ('HIGH','CRITICAL')), 'actors', count(distinct actor_user_id),
    'logins_failed', count(*) filter (where action = 'AUTH_LOGIN_FAILED'),
    'exports', count(*) filter (where action like '%EXPORT%'),
    'config_changes', count(*) filter (where event_category = 'CONFIGURATION'),
    'role_changes', count(*) filter (where event_category = 'ROLES_PERMISSIONS'))
  into v from audit_logs where occurred_at >= p_from and occurred_at < p_to;
  return v || jsonb_build_object(
    'by_category', coalesce((select jsonb_object_agg(event_category, n) from (select coalesce(event_category, 'OTHER') event_category, count(*) n from audit_logs where occurred_at >= p_from and occurred_at < p_to group by 1) q), '{}'::jsonb),
    'open_alerts', (select count(*) from audit_alerts where status in ('NEW','UNDER_REVIEW')),
    'chain', jsonb_build_object('chained', (select max(chain_seq) from audit_logs), 'unchained_history', (select legacy_rows from audit_chain_meta)));
end $$;

-- One event with everything around it: same workflow/record, same request, same session, same person.
create or replace function audit_centre_trace(p_actor uuid, p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare e audit_logs; cols text := 'id, seq, occurred_at, actor_user_id, actor_name, actor_role, action, event_category, severity, outcome, entity_type, entity_id, request_id, session_ref, workflow_id, channel, ip_address';
begin
  perform require_permission(p_actor, 'audit.read');
  select * into e from audit_logs where id = p_event;
  if not found then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object(
    'event', to_jsonb(e) - 'prev_hash' - 'row_hash',
    'chain', jsonb_build_object('chain_seq', e.chain_seq, 'prev_hash', e.prev_hash, 'row_hash', e.row_hash, 'valid', case when e.chain_seq is null then null else e.row_hash = audit_row_hash(e) end),
    'same_request', coalesce((select jsonb_agg(to_jsonb(x) order by x.seq) from (select id, seq, occurred_at, action, outcome, severity, entity_type, entity_id from audit_logs where request_id is not null and request_id = e.request_id order by seq limit 50) x), '[]'::jsonb),
    'same_workflow', coalesce((select jsonb_agg(to_jsonb(x) order by x.seq) from (select id, seq, occurred_at, actor_name, action, outcome, severity, entity_type, entity_id from audit_logs
                                where (e.workflow_id is not null and workflow_id = e.workflow_id) or (entity_type = e.entity_type and entity_id = e.entity_id and e.entity_id is not null) order by seq limit 100) x), '[]'::jsonb),
    'same_session', coalesce((select jsonb_agg(to_jsonb(x) order by x.seq) from (select id, seq, occurred_at, action, outcome, severity, entity_type, entity_id from audit_logs where session_ref is not null and session_ref = e.session_ref order by seq desc limit 50) x), '[]'::jsonb),
    'same_actor', coalesce((select jsonb_agg(to_jsonb(x) order by x.seq desc) from (select id, seq, occurred_at, action, outcome, severity, entity_type, entity_id from audit_logs where e.actor_user_id is not null and actor_user_id = e.actor_user_id and occurred_at between e.occurred_at - interval '1 day' and e.occurred_at + interval '1 day' order by seq desc limit 50) x), '[]'::jsonb));
end $$;

-- Ending a person's sign-in sessions (after a second-factor reset or recovery) is now part of the trail; behaviour is otherwise unchanged.
create or replace function revoke_user_sessions(p_user uuid, p_keep uuid default null) returns int
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare n int;
begin
  delete from auth.sessions where user_id = p_user and (p_keep is null or id <> p_keep);
  get diagnostics n = row_count;
  if n > 0 then perform public.write_audit(null, 'AUTH_SESSIONS_REVOKED', 'user', p_user::text, null, jsonb_build_object('sessions_ended', n, 'kept_one', p_keep is not null)); end if;
  return n;
end $$;

select lock_down_function_grants();

-- ------------------------------------------------------------------ the scheduler also evaluates the rules (a failure here never stops the scheduler's own work)
do $$
declare v_def text; a text := 'begin perform maybe_purge_transient_data();';
begin
  v_def := pg_get_functiondef('run_scheduled_jobs()'::regprocedure);
  if position('audit_run_detection' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise notice 'run_scheduled_jobs anchor not found: audit_run_detection must be scheduled separately'; return; end if;
  execute replace(v_def, a, 'begin perform audit_run_detection(); exception when others then null; end; ' || a);
end $$;
select lock_down_function_grants();
