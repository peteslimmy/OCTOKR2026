-- Owner request (ADR-113, 2026-11-06): (1) the weekly quote becomes a rota; (2) a simple Note Taker role for session notes.
--
-- 1. QUOTE ROTA. HR chooses which business unit gives the quote in each weekly session; that unit's leads are notified and enter the quote and who in their team said it
--    (the Super Admin can enter it for them). The Presenter shows it in the session ("Quote review"). If that week's session is SKIPPED the turn moves to the next session
--    that is held; the quote is not invalidated and the unit still gives it. No approval step. The older single-quote table (weekly_quotes) and its history are untouched.
-- 2. NOTE TAKER. A role whose holder signs in and takes notes on the weekly sessions on one simple screen: one rich-text note per unit and week with Notes, Recommendations,
--    Actions and Next steps. Behind the screen it is an ordinary OKR session and note (ADR-089 to ADR-095), so the full module sees the same record.

-- ------------------------------------------------------------------ permissions
insert into permissions (code, description, protected, reserved, module, risk) values
  ('quote.assign', 'Choose which business unit gives the quote in each weekly session', false, false, 'Sessions & attendance', 'medium'),
  ('quote.submit', 'Enter the weekly quote, and who in the team said it, for your business unit', false, false, 'Sessions & attendance', 'low');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values ('HR','quote.assign'), ('ADMIN','quote.assign'), ('BU_LEAD','quote.submit'), ('SUPER_ADMIN','quote.assign'), ('SUPER_ADMIN','quote.submit')) v(role_code, perm)
join roles r on r.code = v.role_code join permissions p on p.code = v.perm
on conflict do nothing;

insert into email_event_types (event_type, mandatory, description) values
  ('QUOTE_TURN_ASSIGNED',  false, 'Your business unit was chosen to give the quote in a weekly session'),
  ('QUOTE_TURN_MOVED',     false, 'A session was skipped, so your unit''s quote moves to the next session'),
  ('QUOTE_TURN_SUBMITTED', false, 'A business unit entered its quote for a weekly session')
on conflict do nothing;

-- ------------------------------------------------------------------ the rota
create table quote_turns (
  id                  uuid primary key default gen_random_uuid(),
  reporting_week_id   uuid not null references reporting_weeks(id) on delete restrict,       -- the week HR chose; the session it is shown in may be a later one
  business_unit_id    uuid not null references business_units(id) on delete restrict,
  status              text not null default 'ASSIGNED' check (status in ('ASSIGNED','SUBMITTED','PRESENTED','CANCELLED')),
  quote               text check (quote is null or char_length(btrim(quote)) between 1 and 1000),
  speaker_employee_id uuid references employees(id),
  speaker_name        text check (speaker_name is null or btrim(speaker_name) <> ''),
  assigned_by         uuid not null references users(id),
  assigned_at         timestamptz not null default app_now(),
  submitted_by        uuid references users(id),
  submitted_at        timestamptz,
  submitted_for_unit  boolean not null default false,        -- entered by someone outside the unit (the Super Admin) on its behalf
  presented_at        timestamptz,
  presented_by        uuid references users(id),
  cancelled_at        timestamptz,
  cancelled_by        uuid references users(id),
  cancel_reason       text,
  version             int not null default 1,
  check (status not in ('SUBMITTED','PRESENTED') or (quote is not null and speaker_name is not null))
);
create unique index quote_turns_one_active_per_week on quote_turns (reporting_week_id) where status <> 'CANCELLED';
create index quote_turns_unit_idx on quote_turns (business_unit_id, reporting_week_id desc);

create table quote_turn_events (
  id         uuid primary key default gen_random_uuid(),
  seq        bigint generated always as identity,
  turn_id    uuid not null references quote_turns(id) on delete restrict,
  event_type text not null,
  actor_id   uuid references users(id),
  details    jsonb,
  at         timestamptz not null default app_now()
);
create index quote_turn_events_turn_idx on quote_turn_events (turn_id, seq);
create trigger quote_turn_events_immutable before update or delete on quote_turn_events for each row execute function forbid_mutation();

alter table quote_turns enable row level security;
alter table quote_turn_events enable row level security;
grant select on quote_turns, quote_turn_events to authenticated;
create policy read_scoped on quote_turns for select to authenticated using (
  business_unit_id is not distinct from (select auth_bu()) or (select auth_has_any(array['quote.assign','presentation.view','attendance.session.manage'])));
create policy read_scoped on quote_turn_events for select to authenticated using (
  exists (select 1 from quote_turns t where t.id = turn_id));

create or replace function quote_log(p_actor uuid, p_turn uuid, p_event text, p_details jsonb default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t quote_turns;
begin
  select * into t from quote_turns where id = p_turn;
  insert into quote_turn_events (turn_id, event_type, actor_id, details) values (p_turn, p_event, p_actor, p_details);
  perform write_audit(p_actor, 'QUOTE_TURN_' || p_event, 'quote_turn', p_turn::text, null, coalesce(p_details, '{}'::jsonb) || jsonb_build_object('week', t.reporting_week_id), null, t.business_unit_id);
end $$;

-- the unit's own leads (people who may enter its quote)
create or replace function quote_unit_people(p_bu uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(u.id), '{}') from users u where u.status = 'ACTIVE' and actor_bu(u.id) = p_bu and actor_has_permission(u.id, 'quote.submit');
$$;

-- the week's session in which a turn is shown: its own week, unless that session was SKIPPED, then the next week whose session is not (holiday weeks are passed over too)
create or replace function read_quote_effective_week(p_turn uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select rw2.id from quote_turns t
    join reporting_weeks rw on rw.id = t.reporting_week_id
    join reporting_weeks rw2 on rw2.organisation_id = rw.organisation_id and rw2.week_start_at >= rw.week_start_at and rw2.reporting_state = 'NORMAL'
    left join governance_sessions gs on gs.reporting_week_id = rw2.id
   where t.id = p_turn and coalesce(gs.outcome, 'SCHEDULED') <> 'SKIPPED'
   order by rw2.week_start_at limit 1;
$$;

-- HR chooses the unit for a week (choosing another unit replaces an earlier choice that has not been presented)
create or replace function assign_quote_turn(p_actor uuid, p_week uuid, p_bu uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare w reporting_weeks; old quote_turns; v_id uuid; v_name text;
begin
  perform require_permission(p_actor, 'quote.assign');
  select * into w from reporting_weeks where id = p_week;
  if not found then raise exception 'NOT_FOUND' using detail = 'reporting week'; end if;
  if w.reporting_state <> 'NORMAL' then raise exception 'VALIDATION_ERROR' using detail = 'that week is an organisation holiday: there is no session to give a quote in'; end if;
  select name into v_name from business_units where id = p_bu and status = 'ACTIVE';
  if not found then raise exception 'NOT_FOUND' using detail = 'business unit'; end if;
  select * into old from quote_turns where reporting_week_id = p_week and status <> 'CANCELLED' for update;
  if found then
    if old.business_unit_id = p_bu then return jsonb_build_object('id', old.id, 'unchanged', true); end if;
    if old.status = 'PRESENTED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'the quote for that week has already been presented'; end if;
    update quote_turns set status = 'CANCELLED', cancelled_at = app_now(), cancelled_by = p_actor, cancel_reason = 'Another unit was chosen', version = version + 1 where id = old.id;
    perform quote_log(p_actor, old.id, 'CANCELLED', jsonb_build_object('reason', 'Another unit was chosen'));
  end if;
  insert into quote_turns (reporting_week_id, business_unit_id, assigned_by) values (p_week, p_bu, p_actor) returning id into v_id;
  perform quote_log(p_actor, v_id, 'ASSIGNED', jsonb_build_object('business_unit', v_name));
  perform notify_users(quote_unit_people(p_bu), 'QUOTE_TURN_ASSIGNED', 'quote_turn', v_id::text, 'Your unit gives the quote in week ' || w.week_number || ' ' || w.week_year,
    v_name || ' was chosen to give the quote in the weekly session. Enter the quote and who said it under Weekly quote.', 'quote-assigned:' || v_id);
  return jsonb_build_object('id', v_id, 'unchanged', false);
end $$;

create or replace function cancel_quote_turn(p_actor uuid, p_turn uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t quote_turns; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform require_permission(p_actor, 'quote.assign');
  select * into t from quote_turns where id = p_turn for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if t.status in ('CANCELLED', 'PRESENTED') then raise exception 'INVALID_STATE_TRANSITION'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  update quote_turns set status = 'CANCELLED', cancelled_at = app_now(), cancelled_by = p_actor, cancel_reason = left(v_reason, 500), version = version + 1 where id = t.id;
  perform quote_log(p_actor, t.id, 'CANCELLED', jsonb_build_object('reason', left(v_reason, 500)));
end $$;

-- the unit (or the Super Admin on its behalf) enters, and may change, the quote until it is presented
create or replace function submit_quote_turn(p_actor uuid, p_turn uuid, p_quote text, p_speaker uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t quote_turns; v_q text := nullif(btrim(coalesce(p_quote, '')), ''); v_name text; v_for boolean; w reporting_weeks;
begin
  perform require_permission(p_actor, 'quote.submit');
  select * into t from quote_turns where id = p_turn for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (is_super_admin(p_actor) or actor_bu(p_actor) = t.business_unit_id) then raise exception 'BU_SCOPE_DENIED'; end if;
  if t.status not in ('ASSIGNED', 'SUBMITTED') then raise exception 'INVALID_STATE_TRANSITION' using detail = 'this quote is ' || lower(t.status); end if;
  if v_q is null or char_length(v_q) > 1000 then raise exception 'VALIDATION_ERROR' using detail = 'the quote is required (up to 1000 characters)'; end if;
  select e.first_name || ' ' || e.last_name into v_name from employees e where e.id = p_speaker and e.business_unit_id = t.business_unit_id and e.employment_status = 'ACTIVE';
  if v_name is null then raise exception 'VALIDATION_ERROR' using detail = 'choose who said it from the unit''s active team'; end if;
  v_for := actor_bu(p_actor) is distinct from t.business_unit_id;
  update quote_turns set status = 'SUBMITTED', quote = v_q, speaker_employee_id = p_speaker, speaker_name = v_name, submitted_by = p_actor, submitted_at = app_now(), submitted_for_unit = v_for, version = version + 1 where id = t.id;
  perform quote_log(p_actor, t.id, case when t.status = 'SUBMITTED' then 'CHANGED' else 'SUBMITTED' end, jsonb_build_object('speaker', v_name, 'on_behalf', v_for, 'chars', char_length(v_q)));
  select * into w from reporting_weeks where id = t.reporting_week_id;
  perform notify_users(array[t.assigned_by], 'QUOTE_TURN_SUBMITTED', 'quote_turn', t.id::text, 'Quote entered for week ' || w.week_number || ' ' || w.week_year,
    (select name from business_units where id = t.business_unit_id) || ' entered its quote.', 'quote-submitted:' || t.id || ':' || (t.version + 1));
  return jsonb_build_object('id', t.id, 'status', 'SUBMITTED', 'speaker', v_name, 'on_behalf', v_for);
end $$;

-- the Presenter (or Super Admin) marks it as shown in the session
create or replace function mark_quote_turn_presented(p_actor uuid, p_turn uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t quote_turns;
begin
  perform require_permission(p_actor, 'presentation.view');
  select * into t from quote_turns where id = p_turn for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if t.status = 'PRESENTED' then return; end if;
  if t.status <> 'SUBMITTED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'there is no quote to present yet'; end if;
  update quote_turns set status = 'PRESENTED', presented_at = app_now(), presented_by = p_actor, version = version + 1 where id = t.id;
  perform quote_log(p_actor, t.id, 'PRESENTED');
end $$;

-- a skipped session does not cancel the quote: the unit is told it moves
create or replace function quote_turn_skip_notice() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare t quote_turns; w reporting_weeks;
begin
  if new.outcome = 'SKIPPED' and old.outcome is distinct from 'SKIPPED' then
    select * into w from reporting_weeks where id = new.reporting_week_id;
    for t in select * from quote_turns where reporting_week_id = new.reporting_week_id and status in ('ASSIGNED', 'SUBMITTED') loop
      perform quote_log(null, t.id, 'MOVED', jsonb_build_object('reason', 'the session was skipped'));
      perform notify_users(quote_unit_people(t.business_unit_id), 'QUOTE_TURN_MOVED', 'quote_turn', t.id::text, 'Your quote moves to the next session',
        'The session of week ' || w.week_number || ' ' || w.week_year || ' was skipped. Your unit still gives its quote in the next session; nothing needs to be redone.', 'quote-moved:' || t.id || ':' || new.reporting_week_id);
    end loop;
  end if;
  return new;
exception when others then
  raise warning 'quote_turn_skip_notice failed: %', sqlerrm;
  return new;
end $$;
create trigger governance_sessions_quote_moved after update of outcome on governance_sessions for each row execute function quote_turn_skip_notice();

-- ------------------------------------------------------------------ reads (security invoker: the caller's own row-level security applies)
create or replace function read_quote_turn_json(t quote_turns, p_shown_in uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object('id', t.id, 'business_unit_id', t.business_unit_id, 'business_unit_name', (select name from business_units where id = t.business_unit_id),
    'week_id', t.reporting_week_id, 'week_number', (select week_number from reporting_weeks where id = t.reporting_week_id), 'week_year', (select week_year from reporting_weeks where id = t.reporting_week_id),
    'shown_in_week_id', coalesce(p_shown_in, read_quote_effective_week(t.id)), 'carried', coalesce(p_shown_in, read_quote_effective_week(t.id)) is distinct from t.reporting_week_id,
    'status', t.status, 'quote', t.quote, 'speaker_name', t.speaker_name, 'submitted_at', t.submitted_at, 'submitted_by_name', person_name(t.submitted_by), 'submitted_for_unit', t.submitted_for_unit,
    'presented_at', t.presented_at, 'version', t.version);
$$;

-- what to show in the session of one week: the turns whose session is this one (its own, plus any moved here from skipped sessions)
create or replace function read_quote_turns_for_week(p_week uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(read_quote_turn_json(t, p_week) order by rw.week_start_at), '[]'::jsonb)
    from quote_turns t join reporting_weeks rw on rw.id = t.reporting_week_id
   where t.status <> 'CANCELLED' and read_quote_effective_week(t.id) = p_week;
$$;

-- HR's view: the coming and recent weeks with the unit chosen for each (and what is still waiting)
create or replace function read_quote_rota() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('week_id', rw.id, 'week_number', rw.week_number, 'week_year', rw.week_year, 'week_start_at', rw.week_start_at, 'reporting_state', rw.reporting_state,
           'session_outcome', gs.outcome, 'turn', case when t.id is null then null else read_quote_turn_json(t, null) end) order by rw.week_start_at), '[]'::jsonb)
    from reporting_weeks rw left join governance_sessions gs on gs.reporting_week_id = rw.id
    left join quote_turns t on t.reporting_week_id = rw.id and t.status <> 'CANCELLED'
   where rw.week_start_at >= app_now() - interval '21 days' and rw.week_start_at <= app_now() + interval '90 days';
$$;

-- the unit's own turns (the caller's unit)
create or replace function read_my_quote_turns(p_bu uuid default null) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(read_quote_turn_json(t, null) order by rw.week_start_at desc), '[]'::jsonb)
    from quote_turns t join reporting_weeks rw on rw.id = t.reporting_week_id
   where t.status <> 'CANCELLED' and t.business_unit_id = coalesce(p_bu, auth_bu());
$$;

-- the unit's active people, for "who said it" (the unit itself, or someone who assigns or enters quotes for it)
create or replace function read_quote_speakers(p_bu uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (auth_has_permission('quote.assign') or (auth_has_permission('quote.submit') and (auth_bu() = p_bu or is_super_admin(auth.uid())))) then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.first_name || ' ' || e.last_name) order by e.first_name, e.last_name), '[]'::jsonb)
            from employees e where e.business_unit_id = p_bu and e.employment_status = 'ACTIVE');
end $$;

-- ------------------------------------------------------------------ the Note Taker
insert into roles (code, name, description, is_system) values
  ('NOTE_TAKER', 'Note Taker', 'Signs in to take notes on the weekly OKR sessions: notes, recommendations, actions and next steps, on one simple screen.', false)
on conflict (code) do nothing;
insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values ('session_notes.view'), ('session_notes.view_all'), ('session_notes.create'), ('session_notes.update'), ('session_notes.export')) v(perm)
join roles r on r.code = 'NOTE_TAKER' join permissions p on p.code = v.perm
on conflict do nothing;

-- one place per unit and week: opens (or finds) that unit's session for the week and its single notes page; the same record the full module shows
create or replace function get_or_create_notes_session(p_actor uuid, p_week uuid, p_bu uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare w reporting_weeks; v_name text; v_type uuid; v_s uuid; v_status text; v_note uuid; v_key text := 'notes-' || p_bu || '-' || p_week;
begin
  perform require_permission(p_actor, 'session_notes.create');
  select * into w from reporting_weeks where id = p_week;
  if not found then raise exception 'NOT_FOUND' using detail = 'reporting week'; end if;
  select name into v_name from business_units where id = p_bu;
  if not found then raise exception 'NOT_FOUND' using detail = 'business unit'; end if;
  select id into v_type from okr_session_types where code = 'WEEKLY_OKR_REVIEW';
  select s.id, s.status into v_s, v_status from okr_sessions s
   where s.business_unit_id = p_bu and s.reporting_week_id = p_week and s.session_type_id = v_type and s.status <> 'ARCHIVED' order by s.created_at limit 1;
  if v_s is not null and not okr_session_visible_to(p_actor, v_s) then raise exception 'BU_SCOPE_DENIED'; end if;
  if v_s is null then
    v_s := (create_okr_session(p_actor, left('Week ' || w.week_number || ' ' || w.week_year || ' - ' || v_name, 200), v_type, okr_today_wat(), p_week, p_bu, null, null, null, p_actor, null, null, '[]'::jsonb, v_key) ->> 'id')::uuid;
    v_status := 'DRAFT';
  end if;
  if v_status = 'DRAFT' then perform transition_okr_session(p_actor, v_s, 'IN_PROGRESS', null, null, 'start-' || v_key); end if;
  select n.id into v_note from okr_session_notes n where n.session_id = v_s and n.status = 'ACTIVE' and n.title = 'Session notes' order by n.created_at limit 1;
  if v_note is null then
    v_note := (create_okr_note(p_actor, v_s, 'GENERAL_DISCUSSION', 'Session notes',
      E'## Notes\n\n\n## Recommendations\n\n\n## Actions\n\n- [ ] \n\n## Next steps\n\n', 'SHARED', '[]'::jsonb, 'main-' || v_key, case when v_status = 'COMPLETED' then 'Notes added after the session' else null end) ->> 'id')::uuid;
  end if;
  return jsonb_build_object('session_id', v_s, 'note_id', v_note);
end $$;

select lock_down_function_grants();
