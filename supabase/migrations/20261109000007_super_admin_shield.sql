-- Super Admin accounts are invisible to everyone who is not a Super Admin (ADR-118).
-- One rule (hidden_user_ids / hidden_employee_ids / shield_active), enforced in the database where a person can be read: the users, roles, grants, scopes, employee and
-- audit tables. Anything a Super Admin did stays in the audit log, but only Super Admins can read it. Shared business records show "Administration" instead of a name.
-- The server (service role, no signed-in person) sees everything; code that lists people for a signed-in viewer applies the same rule itself (src/lib/auth/shield.ts).

-- true for a person who is NOT a Super Admin (null = the server, which is never shielded)
create or replace function viewer_is_shielded(p_viewer uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_viewer is not null and not is_super_admin(p_viewer);
$$;

-- the accounts a given person must not see (none for a Super Admin, and none for the server)
create or replace function hidden_user_ids_for(p_viewer uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select case when not viewer_is_shielded(p_viewer) then '{}'::uuid[]
    else coalesce((select array_agg(distinct ur.user_id) from user_roles ur join roles r on r.id = ur.role_id where r.code = 'SUPER_ADMIN'), '{}'::uuid[]) end;
$$;

create or replace function hidden_employee_ids_for(p_viewer uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select case when not viewer_is_shielded(p_viewer) then '{}'::uuid[]
    else coalesce((select array_agg(u.employee_id) from users u where u.employee_id is not null and u.id = any (hidden_user_ids_for(p_viewer))), '{}'::uuid[]) end;
$$;

-- the same for the signed-in person (used by the row-level-security rules)
create or replace function shield_active() returns boolean language sql stable security definer set search_path = public, pg_temp as $$ select viewer_is_shielded(auth.uid()); $$;
create or replace function hidden_user_ids() returns uuid[] language sql stable security definer set search_path = public, pg_temp as $$ select hidden_user_ids_for(auth.uid()); $$;
create or replace function hidden_employee_ids() returns uuid[] language sql stable security definer set search_path = public, pg_temp as $$ select hidden_employee_ids_for(auth.uid()); $$;

-- the list the roster screens already read, now from the one rule
create or replace function read_hidden_employee_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$ select hidden_employee_ids(); $$;

-- a person's name for a record other people read: "Administration" for a Super Admin the reader may not see
create or replace function eo_person_name(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when u.id = any (hidden_user_ids()) then 'Administration' else e.first_name || ' ' || e.last_name end
    from users u join employees e on e.id = u.employee_id where u.id = p_user;
$$;

-- the people who can be picked in a session: Super Admins only for another Super Admin
create or replace function read_okr_people() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not auth_has_any(array['session_notes.view','session_actions.update','session_actions.create']) then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', e.first_name || ' ' || e.last_name, 'business_unit_id', e.business_unit_id, 'business_unit_name', b.name,
            'can_view_sessions', actor_has_permission(u.id, 'session_notes.view')) order by e.first_name, e.last_name), '[]'::jsonb)
          from users u join employees e on e.id = u.employee_id join business_units b on b.id = e.business_unit_id
          where u.status = 'ACTIVE' and e.employment_status = 'ACTIVE' and u.id <> all (hidden_user_ids()));
end $$;

create or replace function read_quote_speakers(p_bu uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (auth_has_permission('quote.assign') or (auth_has_permission('quote.submit') and (auth_bu() = p_bu or is_super_admin(auth.uid())))) then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.first_name || ' ' || e.last_name) order by e.first_name, e.last_name), '[]'::jsonb)
            from employees e where e.business_unit_id = p_bu and e.employment_status = 'ACTIVE' and e.id <> all (hidden_employee_ids()));
end $$;

-- the read rules: each existing select rule is kept and narrowed by "not a hidden person" (idempotent: a rule that already names the shield is left alone)
do $$
declare w record; r record; fn text;
begin
  for w in select * from (values
    ('users', 'id', 'u'), ('user_roles', 'user_id', 'u'), ('user_permission_grants', 'user_id', 'u'), ('user_unit_scopes', 'user_id', 'u'),
    ('access_review_items', 'user_id', 'u'), ('okr_session_participants', 'user_id', 'u'),
    ('employees', 'id', 'e'), ('employee_lifecycle_events', 'employee_id', 'e')
  ) as v(tbl, col, kind) loop
    fn := case when w.kind = 'u' then 'hidden_user_ids' else 'hidden_employee_ids' end;
    for r in select policyname, qual from pg_policies where schemaname = 'public' and tablename = w.tbl and cmd in ('SELECT', 'ALL') loop
      continue when r.qual like '%hidden\_%';
      execute format('alter policy %I on %I using ((%s) and (%I is null or %I <> all ((select %s())::uuid[])))', r.policyname, w.tbl, r.qual, w.col, w.col, fn);
    end loop;
  end loop;
end $$;

-- the audit log: nothing a Super Admin did, and nothing done to a Super Admin's account, is readable by anyone else
do $$
declare r record;
begin
  for r in select policyname, qual from pg_policies where schemaname = 'public' and tablename = 'audit_logs' and cmd in ('SELECT', 'ALL') loop
    continue when r.qual like '%hidden\_%';
    execute format($f$alter policy %I on audit_logs using ((%s) and (
        not (select shield_active())
        or (coalesce(actor_role, '') not ilike '%%SUPER\_ADMIN%%'
            and (actor_user_id is null or actor_user_id <> all ((select hidden_user_ids())::uuid[]))
            and (entity_id is null or entity_type not in ('user', 'users') or entity_id not in (select unnest((select hidden_user_ids()))::text))
            and (entity_id is null or entity_type not in ('employee', 'employees') or entity_id not in (select unnest((select hidden_employee_ids()))::text))))
      )$f$, r.policyname, r.qual);
  end loop;
end $$;

-- ---------------------------------------------------------------- the Audit & Security Centre
-- An alert is hidden from anyone who may not see the events behind it (or the person it is about).
create or replace function audit_alert_visible(p_viewer uuid, p_subject uuid, p_ids uuid[]) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_hu uuid[] := hidden_user_ids_for(p_viewer); v_he uuid[] := hidden_employee_ids_for(p_viewer);
begin
  if not viewer_is_shielded(p_viewer) then return true; end if;
  if p_subject is not null and p_subject = any (v_hu) then return false; end if;
  return not exists (select 1 from audit_logs a where a.id = any (p_ids) and (
      coalesce(a.actor_role, '') ilike '%SUPER\_ADMIN%' or a.actor_user_id = any (v_hu)
      or (a.entity_type in ('user', 'users') and a.entity_id = any (select x::text from unnest(v_hu) x))
      or (a.entity_type in ('employee', 'employees') and a.entity_id = any (select x::text from unnest(v_he) x))));
end $$;

-- Whether an alert involves a Super Admin is decided once, when the alert is raised (a per-row function call in a read rule would break the project's row-security cost rule), and kept on the row.
alter table audit_alerts add column if not exists involves_hidden boolean not null default false;
create or replace function audit_alert_set_involves_hidden() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.involves_hidden := (new.subject_user_id is not null and is_super_admin(new.subject_user_id))
    or exists (select 1 from audit_logs a where a.id = any (new.evidence_event_ids) and (
         coalesce(a.actor_role, '') ilike '%SUPER\_ADMIN%' or (a.actor_user_id is not null and is_super_admin(a.actor_user_id))
         or (a.entity_type in ('user', 'users') and a.entity_id ~ '^[0-9a-f-]{36}$' and is_super_admin(a.entity_id::uuid))
         or (a.entity_type in ('employee', 'employees') and a.entity_id ~ '^[0-9a-f-]{36}$' and exists (select 1 from users u where u.employee_id = a.entity_id::uuid and is_super_admin(u.id)))));
  return new;
end $$;
drop trigger if exists audit_alerts_involves_hidden on audit_alerts;
create trigger audit_alerts_involves_hidden before insert on audit_alerts for each row execute function audit_alert_set_involves_hidden();
-- the trigger does not run on update, so the alerts that already exist are set directly
update audit_alerts al set involves_hidden = (al.subject_user_id is not null and is_super_admin(al.subject_user_id))
  or exists (select 1 from audit_logs a where a.id = any (al.evidence_event_ids) and (coalesce(a.actor_role, '') ilike '%SUPER\_ADMIN%' or (a.actor_user_id is not null and is_super_admin(a.actor_user_id))));

do $$
declare r record;
begin
  for r in select policyname, qual from pg_policies where schemaname = 'public' and tablename = 'audit_alerts' and cmd in ('SELECT', 'ALL') loop
    continue when r.qual like '%involves\_hidden%';
    execute format('alter policy %I on audit_alerts using ((%s) and (not involves_hidden or not (select shield_active())))', r.policyname, r.qual);
  end loop;
end $$;

create or replace function audit_centre_kpis(p_actor uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb; v_hide boolean := viewer_is_shielded(p_actor); v_hu uuid[] := hidden_user_ids_for(p_actor); v_he uuid[] := hidden_employee_ids_for(p_actor);
        v_hut text[]; v_het text[];
begin
  perform require_permission(p_actor, 'audit.read');
  v_hut := coalesce((select array_agg(x::text) from unnest(v_hu) x), '{}'); v_het := coalesce((select array_agg(x::text) from unnest(v_he) x), '{}');
  select jsonb_build_object(
    'total', count(*), 'failed_or_denied', count(*) filter (where outcome in ('FAILURE','DENIED','REJECTED')),
    'denied', count(*) filter (where outcome = 'DENIED'), 'failures', count(*) filter (where outcome = 'FAILURE'),
    'high_or_critical', count(*) filter (where severity in ('HIGH','CRITICAL')), 'actors', count(distinct actor_user_id),
    'logins_failed', count(*) filter (where action = 'AUTH_LOGIN_FAILED'),
    'exports', count(*) filter (where action like '%EXPORT%'),
    'config_changes', count(*) filter (where event_category = 'CONFIGURATION'),
    'role_changes', count(*) filter (where event_category = 'ROLES_PERMISSIONS'))
  into v from audit_logs a where a.occurred_at >= p_from and a.occurred_at < p_to
    and (not v_hide or (coalesce(a.actor_role, '') not ilike '%SUPER\_ADMIN%' and (a.actor_user_id is null or a.actor_user_id <> all (v_hu))
         and (a.entity_id is null or a.entity_type not in ('user', 'users') or a.entity_id <> all (v_hut))
         and (a.entity_id is null or a.entity_type not in ('employee', 'employees') or a.entity_id <> all (v_het))));
  return v || jsonb_build_object(
    'by_category', coalesce((select jsonb_object_agg(event_category, n) from (select coalesce(a.event_category, 'OTHER') event_category, count(*) n from audit_logs a where a.occurred_at >= p_from and a.occurred_at < p_to
        and (not v_hide or (coalesce(a.actor_role, '') not ilike '%SUPER\_ADMIN%' and (a.actor_user_id is null or a.actor_user_id <> all (v_hu))
         and (a.entity_id is null or a.entity_type not in ('user', 'users') or a.entity_id <> all (v_hut))
         and (a.entity_id is null or a.entity_type not in ('employee', 'employees') or a.entity_id <> all (v_het)))) group by 1) q), '{}'::jsonb),
    'open_alerts', (select count(*) from audit_alerts al where al.status in ('NEW','UNDER_REVIEW') and (not al.involves_hidden or not v_hide)),
    'chain', jsonb_build_object('chained', (select max(chain_seq) from audit_logs), 'unchained_history', (select legacy_rows from audit_chain_meta)));
end $$;

create or replace function audit_centre_trace(p_actor uuid, p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare e audit_logs; v_hide boolean := viewer_is_shielded(p_actor); v_hu uuid[] := hidden_user_ids_for(p_actor); v_he uuid[] := hidden_employee_ids_for(p_actor); v_hut text[]; v_het text[];
begin
  perform require_permission(p_actor, 'audit.read');
  v_hut := coalesce((select array_agg(x::text) from unnest(v_hu) x), '{}'); v_het := coalesce((select array_agg(x::text) from unnest(v_he) x), '{}');
  select * into e from audit_logs a where a.id = p_event
    and (not v_hide or (coalesce(a.actor_role, '') not ilike '%SUPER\_ADMIN%' and (a.actor_user_id is null or a.actor_user_id <> all (v_hu))
         and (a.entity_id is null or a.entity_type not in ('user', 'users') or a.entity_id <> all (v_hut))
         and (a.entity_id is null or a.entity_type not in ('employee', 'employees') or a.entity_id <> all (v_het))));
  if not found then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object(
    'event', to_jsonb(e) - 'prev_hash' - 'row_hash',
    'chain', jsonb_build_object('chain_seq', e.chain_seq, 'prev_hash', e.prev_hash, 'row_hash', e.row_hash, 'valid', case when e.chain_seq is null then null else e.row_hash = audit_row_hash(e) end),
    'same_request', coalesce((select jsonb_agg(to_jsonb(x) order by x.seq) from (select a.id, a.seq, a.occurred_at, a.action, a.outcome, a.severity, a.entity_type, a.entity_id from audit_logs a where a.request_id is not null and a.request_id = e.request_id
        and (not v_hide or (coalesce(a.actor_role, '') not ilike '%SUPER\_ADMIN%' and (a.actor_user_id is null or a.actor_user_id <> all (v_hu))
         and (a.entity_id is null or a.entity_type not in ('user', 'users') or a.entity_id <> all (v_hut))
         and (a.entity_id is null or a.entity_type not in ('employee', 'employees') or a.entity_id <> all (v_het)))) order by a.seq limit 50) x), '[]'::jsonb),
    'same_workflow', coalesce((select jsonb_agg(to_jsonb(x) order by x.seq) from (select a.id, a.seq, a.occurred_at, a.actor_name, a.action, a.outcome, a.severity, a.entity_type, a.entity_id from audit_logs a
                                where ((e.workflow_id is not null and a.workflow_id = e.workflow_id) or (a.entity_type = e.entity_type and a.entity_id = e.entity_id and e.entity_id is not null))
        and (not v_hide or (coalesce(a.actor_role, '') not ilike '%SUPER\_ADMIN%' and (a.actor_user_id is null or a.actor_user_id <> all (v_hu))
         and (a.entity_id is null or a.entity_type not in ('user', 'users') or a.entity_id <> all (v_hut))
         and (a.entity_id is null or a.entity_type not in ('employee', 'employees') or a.entity_id <> all (v_het)))) order by a.seq limit 100) x), '[]'::jsonb),
    'same_session', coalesce((select jsonb_agg(to_jsonb(x) order by x.seq) from (select a.id, a.seq, a.occurred_at, a.action, a.outcome, a.severity, a.entity_type, a.entity_id from audit_logs a where a.session_ref is not null and a.session_ref = e.session_ref
        and (not v_hide or (coalesce(a.actor_role, '') not ilike '%SUPER\_ADMIN%' and (a.actor_user_id is null or a.actor_user_id <> all (v_hu))
         and (a.entity_id is null or a.entity_type not in ('user', 'users') or a.entity_id <> all (v_hut))
         and (a.entity_id is null or a.entity_type not in ('employee', 'employees') or a.entity_id <> all (v_het)))) order by a.seq desc limit 50) x), '[]'::jsonb),
    'same_actor', coalesce((select jsonb_agg(to_jsonb(x) order by x.seq desc) from (select a.id, a.seq, a.occurred_at, a.action, a.outcome, a.severity, a.entity_type, a.entity_id from audit_logs a where e.actor_user_id is not null and a.actor_user_id = e.actor_user_id and a.occurred_at between e.occurred_at - interval '1 day' and e.occurred_at + interval '1 day'
        and (not v_hide or (coalesce(a.actor_role, '') not ilike '%SUPER\_ADMIN%' and (a.actor_user_id is null or a.actor_user_id <> all (v_hu))
         and (a.entity_id is null or a.entity_type not in ('user', 'users') or a.entity_id <> all (v_hut))
         and (a.entity_id is null or a.entity_type not in ('employee', 'employees') or a.entity_id <> all (v_het)))) order by a.seq desc limit 50) x), '[]'::jsonb));
end $$;

-- A security indicator is notified only to people who may see the events behind it (a Super Admin's activity is told only to Super Admins; the notice would otherwise reveal it exists).
-- The rest of audit_run_detection is unchanged: it is patched in place rather than restated.
do $$
declare v_def text; a text := 'users_with_permission(''audit.alerts.manage'')';
begin
  v_def := pg_get_functiondef('audit_run_detection()'::regprocedure);
  if position(a in v_def) = 0 then raise exception 'audit_run_detection changed'; end if;
  if position('audit_alert_visible' in v_def) > 0 then return; end if;
  execute replace(v_def, a, 'array(select u from unnest(users_with_permission(''audit.alerts.manage'')) u where audit_alert_visible(u, case when r.group_by = ''ACTOR'' then g.actor end, g.ids))');
end $$;

-- the three helpers are called from row-level-security rules, so signed-in people must be able to run them: added to the allow-list the same way earlier migrations did
do $$
declare v_def text; a text := '''auth_okr_session_visible'',';
begin
  v_def := pg_get_functiondef('lock_down_function_grants()'::regprocedure);
  if position(a in v_def) = 0 then raise exception 'lock_down_function_grants changed'; end if;
  if position('shield_active' in v_def) > 0 then return; end if;
  execute replace(v_def, a, '''shield_active'',''hidden_user_ids'',''hidden_employee_ids'',''viewer_is_shielded'',''hidden_user_ids_for'',''hidden_employee_ids_for'',''audit_alert_visible'',' || a);
end $$;
select lock_down_function_grants();
