-- OKR Session Notes & Meeting Intelligence, part 1 of 3: sessions, participants, notes, versions, links, timeline, permissions.
-- (ADR-0S1..ADR-0S9 in docs/24-DECISIONS.md)
--
-- Additive only. Nothing existing is altered except the allow-list inside lock_down_function_grants() (three RLS helpers must be callable by signed-in people).
-- Rules this migration builds in:
--  * An OKR session (a BU presenting its OKR performance to a Presenter) is NOT the HR attendance session (governance_sessions, one per reporting week, roster/outcome).
--    They may reference each other (okr_sessions.governance_session_id); neither ever changes the other.
--  * Notes, links and every register record are reference material about OKR work. Nothing here writes to goals, tasks, reports, scores or compliance.
--  * Reads go through row-level security (visibility = permission AND own BU / participant / view_all, and per-note classification);
--    writes go only through the SECURITY DEFINER functions (service role), each of which re-checks permission, scope, state and writes the audit in the same transaction.
--  * Nothing is deleted: notes are archived, participants are removed with a date, every earlier version of a note is kept (immutable).
--  * HR, Finance, Admin and Super Admin are given NO access to session content. Admin and Super Admin only get session_notes.configure (the list of session types).

-- ------------------------------------------------------------------ permissions
insert into permissions (code, description, protected, reserved, module, risk) values
  ('session_notes.view',        'Open the OKR sessions of your own business unit and those you are invited to',                  false, false, 'Session notes & meetings', 'low'),
  ('session_notes.view_all',    'Open the OKR sessions of every business unit (and the notes classified for management)',        true,  false, 'Session notes & meetings', 'critical'),
  ('session_notes.create',      'Create OKR sessions and write notes in them',                                                    false, false, 'Session notes & meetings', 'medium'),
  ('session_notes.update',      'Edit notes and session details (your own notes; others only as facilitator or finaliser)',       false, false, 'Session notes & meetings', 'medium'),
  ('session_notes.finalise',    'Review and finalise session minutes; edit any note of a session',                                false, false, 'Session notes & meetings', 'high'),
  ('session_notes.archive',     'Archive and restore OKR sessions',                                                               false, false, 'Session notes & meetings', 'high'),
  ('session_notes.export',      'Export session minutes and registers you can see',                                               false, false, 'Session notes & meetings', 'medium'),
  ('session_notes.configure',   'Manage the list of OKR session types (no access to session content)',                           false, false, 'Session notes & meetings', 'high'),
  ('session_decisions.create',  'Record and amend proposed decisions',                                                            false, false, 'Session notes & meetings', 'medium'),
  ('session_decisions.approve', 'Approve, reject or supersede a decision (only an approved decision is a formal decision)',      true,  false, 'Session notes & meetings', 'critical'),
  ('session_actions.create',    'Create action items from a session',                                                             false, false, 'Session notes & meetings', 'medium'),
  ('session_actions.assign',    'Assign, reassign, extend and escalate action items',                                             false, false, 'Session notes & meetings', 'medium'),
  ('session_actions.update',    'Report progress on action items of your business unit',                                          false, false, 'Session notes & meetings', 'medium'),
  ('session_actions.verify',    'Verify (or send back) the completion of an action item',                                         false, false, 'Session notes & meetings', 'medium'),
  ('session_risks.manage',      'Record and update risks, blockers and issues',                                                   false, false, 'Session notes & meetings', 'medium');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values
  ('BU_LEAD','session_notes.view'), ('BU_LEAD','session_notes.create'), ('BU_LEAD','session_notes.update'), ('BU_LEAD','session_notes.export'), ('BU_LEAD','session_actions.update'),
  ('PRESENTER','session_notes.view'), ('PRESENTER','session_notes.view_all'), ('PRESENTER','session_notes.create'), ('PRESENTER','session_notes.update'),
  ('PRESENTER','session_notes.finalise'), ('PRESENTER','session_notes.archive'), ('PRESENTER','session_notes.export'),
  ('PRESENTER','session_decisions.create'), ('PRESENTER','session_decisions.approve'),
  ('PRESENTER','session_actions.create'), ('PRESENTER','session_actions.assign'), ('PRESENTER','session_actions.update'), ('PRESENTER','session_actions.verify'),
  ('PRESENTER','session_risks.manage'),
  ('EXECUTIVE','session_notes.view'), ('EXECUTIVE','session_notes.view_all'), ('EXECUTIVE','session_notes.export'),
  ('DIRECTOR','session_notes.view'),  ('DIRECTOR','session_notes.view_all'),  ('DIRECTOR','session_notes.export'),
  ('ADMIN','session_notes.configure'), ('SUPER_ADMIN','session_notes.configure')
) v(role_code, perm) join roles r on r.code = v.role_code join permissions p on p.code = v.perm
on conflict do nothing;

-- ------------------------------------------------------------------ session types (configurable, not hard-coded)
create table okr_session_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name        text not null check (btrim(name) <> '' and char_length(name) <= 100),
  description text check (description is null or char_length(description) <= 500),
  sort_order  int  not null default 100,
  active      boolean not null default true,
  created_at  timestamptz not null default app_now(),
  updated_at  timestamptz not null default app_now()
);
insert into okr_session_types (code, name, sort_order, description) values
  ('WEEKLY_OKR_REVIEW',         'Weekly OKR Review',         10, 'A business unit presents its weekly OKR performance'),
  ('QUARTERLY_OKR_REVIEW',      'Quarterly OKR Review',      20, 'End-of-quarter review of objectives, key results and scores'),
  ('STRATEGY_REVIEW',           'Strategy Review',           30, 'Review of strategy and the OKR structure'),
  ('PERFORMANCE_REVIEW',        'Performance Review',        40, 'Focused review of a unit''s or a theme''s performance'),
  ('SPECIAL_MANAGEMENT_REVIEW', 'Special Management Review', 50, 'A review called by management outside the normal rhythm'),
  ('AD_HOC',                    'Ad-hoc OKR Session',        60, 'Any other OKR discussion worth recording');

-- ------------------------------------------------------------------ plumbing
create table okr_counters (
  kind text not null,
  year int  not null,
  last int  not null default 0,
  primary key (kind, year)
);

-- A request key claims an operation for one person. A repeat of the same request returns the first answer; the same key for a different operation is refused.
create table okr_idempotency (
  actor_id   uuid not null references users(id) on delete cascade,
  key        text not null check (char_length(key) between 8 and 100),
  op         text not null,
  result     jsonb,
  created_at timestamptz not null default app_now(),
  primary key (actor_id, key)
);

create or replace function okr_next_ref(p_kind text, p_prefix text, p_year int) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  insert into okr_counters (kind, year, last) values (p_kind, p_year, 1)
    on conflict (kind, year) do update set last = okr_counters.last + 1 returning last into n;
  return p_prefix || '-' || p_year || '-' || lpad(n::text, 4, '0');
end $$;

-- a JSON list argument that is not a list is treated as empty
create or replace function okr_arr(p jsonb) returns jsonb language sql immutable as $$ select case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end $$;

-- Returns the stored answer if this actor already completed this key for this op; null if the caller should proceed (the key is then claimed by this transaction).
create or replace function okr_idem(p_actor uuid, p_key text, p_op text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r okr_idempotency;
begin
  if p_key is null then return null; end if;
  if char_length(p_key) < 8 or char_length(p_key) > 100 then raise exception 'VALIDATION_ERROR' using detail = 'the request key must be 8 to 100 characters'; end if;
  insert into okr_idempotency (actor_id, key, op) values (p_actor, p_key, p_op) on conflict do nothing;   -- a concurrent twin waits here until the first commits
  select * into r from okr_idempotency where actor_id = p_actor and key = p_key;
  if r.op <> p_op then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
  if r.result is not null then return r.result || jsonb_build_object('replayed', true); end if;
  return null;
end $$;

create or replace function okr_idem_done(p_actor uuid, p_key text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_key is not null then update okr_idempotency set result = p_result where actor_id = p_actor and key = p_key; end if;
  return p_result;
end $$;

-- ------------------------------------------------------------------ sessions
create table okr_sessions (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique,
  title                 text not null check (btrim(title) <> '' and char_length(title) <= 200),
  session_type_id       uuid not null references okr_session_types(id),
  quarter_id            uuid references quarters(id),
  reporting_week_id     uuid references reporting_weeks(id),
  business_unit_id      uuid references business_units(id),            -- null = organisation-wide
  governance_session_id uuid references governance_sessions(id),       -- optional reference to the HR attendance session of that week; never changes it
  session_date          date not null,
  starts_at             timestamptz,
  ends_at               timestamptz,
  facilitator_id        uuid not null references users(id),
  description           text check (description is null or char_length(description) <= 4000),
  agenda                text check (agenda is null or char_length(agenda) <= 20000),
  status                text not null default 'DRAFT' check (status in ('DRAFT','IN_PROGRESS','COMPLETED','ARCHIVED')),
  archived_from         text check (archived_from in ('DRAFT','COMPLETED')),
  started_at            timestamptz,
  completed_at          timestamptz,
  completed_by          uuid references users(id),
  archived_at           timestamptz,
  archived_by           uuid references users(id),
  version               int not null default 1,
  created_by            uuid not null references users(id),
  created_at            timestamptz not null default app_now(),
  updated_at            timestamptz not null default app_now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at),
  check ((status = 'ARCHIVED') = (archived_at is not null))
);
create index okr_sessions_bu_date_idx on okr_sessions (business_unit_id, session_date desc);
create index okr_sessions_week_idx    on okr_sessions (reporting_week_id);
create index okr_sessions_quarter_idx on okr_sessions (quarter_id);
create index okr_sessions_status_idx  on okr_sessions (status);
create index okr_sessions_facilitator_idx on okr_sessions (facilitator_id);
create index okr_sessions_governance_idx on okr_sessions (governance_session_id) where governance_session_id is not null;
-- Several sessions per BU per week are legitimate (a weekly review, a follow-up, a special review): deliberately no unique constraint on (BU, week).

create table okr_session_participants (
  session_id uuid not null references okr_sessions(id) on delete restrict,
  user_id    uuid not null references users(id),
  role       text not null default 'ATTENDEE' check (role in ('FACILITATOR','PRESENTER','BU_LEAD','ATTENDEE','OBSERVER')),
  added_by   uuid not null references users(id),
  added_at   timestamptz not null default app_now(),
  removed_at timestamptz,
  removed_by uuid references users(id),
  primary key (session_id, user_id)
);
create index okr_session_participants_user_idx on okr_session_participants (user_id) where removed_at is null;

-- ------------------------------------------------------------------ notes
create table okr_session_notes (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references okr_sessions(id) on delete restrict,
  category       text not null default 'GENERAL_DISCUSSION' check (category in (
    'GENERAL_DISCUSSION','PERFORMANCE_OBSERVATION','QUESTION_RAISED','BU_RESPONSE','MANAGEMENT_FEEDBACK','CHALLENGE_CONCERN',
    'RISK_BLOCKER','RECOMMENDATION','DECISION','ACTION_ITEM','FOLLOW_UP')),
  title          text check (title is null or char_length(title) <= 200),
  content        text not null default '' check (char_length(content) <= 100000),   -- a small, safe markdown subset (src/lib/session-notes/markdown.ts); never HTML
  visibility     text not null default 'SHARED' check (visibility in ('SHARED','MANAGEMENT','CONFIDENTIAL')),
  author_id      uuid not null references users(id),
  last_edited_by uuid not null references users(id),
  version        int not null default 1,
  status         text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
  archived_at    timestamptz,
  archived_by    uuid references users(id),
  archive_reason text check (archive_reason is null or char_length(archive_reason) <= 2000),
  client_key     text check (client_key is null or char_length(client_key) between 8 and 100),
  noted_at       timestamptz not null default app_now(),     -- the place on the session timeline
  created_at     timestamptz not null default app_now(),
  updated_at     timestamptz not null default app_now(),
  check ((status = 'ARCHIVED') = (archived_at is not null))
);
create index okr_session_notes_session_idx on okr_session_notes (session_id, noted_at);
create index okr_session_notes_author_idx on okr_session_notes (author_id);
create index okr_session_notes_category_idx on okr_session_notes (category);
create unique index okr_session_notes_client_key_idx on okr_session_notes (author_id, client_key) where client_key is not null;
create index okr_session_notes_fts_idx on okr_session_notes using gin (to_tsvector('simple', coalesce(title, '') || ' ' || content));

-- every settled earlier state of a note, kept for good
create table okr_session_note_versions (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references okr_session_notes(id) on delete restrict,
  version     int  not null,
  category    text not null,
  title       text,
  content     text not null,
  visibility  text not null,
  status      text not null,
  saved_by    uuid not null references users(id),     -- who wrote this state
  saved_at    timestamptz not null,                   -- when this state was written
  superseded_by uuid not null references users(id),   -- who replaced it
  superseded_at timestamptz not null default app_now(),
  change_kind text not null check (change_kind in ('EDITED','AMENDED_AFTER_COMPLETION','ARCHIVED','RESTORED','RECLASSIFIED')),
  reason      text
);
create index okr_session_note_versions_note_idx on okr_session_note_versions (note_id, version desc);
create trigger okr_session_note_versions_immutable before update or delete on okr_session_note_versions for each row execute function forbid_mutation();

-- ------------------------------------------------------------------ links from notes and register records to OKR components
-- The target is looked up (and its title kept as it was when linked), so a link still reads after the goal, week or quarter is archived or locked.
create table okr_session_links (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references okr_sessions(id) on delete restrict,
  owner_type  text not null check (owner_type in ('NOTE','DECISION','ACTION','RISK')),
  owner_id    uuid not null,
  target_type text not null check (target_type in ('ANNUAL_THEME','QUARTER','OBJECTIVE','KEY_RESULT','SUB_KEY_RESULT','BU_GOAL','WEEKLY_GOAL','TASK','WEEKLY_REPORT')),
  target_id   uuid not null,
  label       text not null,
  target_bu_id uuid references business_units(id),
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default app_now(),
  removed_at  timestamptz,
  removed_by  uuid references users(id)
);
create unique index okr_session_links_unique_idx on okr_session_links (owner_type, owner_id, target_type, target_id) where removed_at is null;
create index okr_session_links_target_idx on okr_session_links (target_type, target_id) where removed_at is null;
create index okr_session_links_owner_idx on okr_session_links (owner_type, owner_id);

-- ------------------------------------------------------------------ the session timeline (what happened, by whom). The audit log holds the same facts for administrators.
create table okr_session_events (
  id          uuid primary key default gen_random_uuid(),
  seq         bigint generated always as identity,
  session_id  uuid not null references okr_sessions(id) on delete restrict,
  record_type text not null check (record_type in ('SESSION','NOTE','DECISION','ACTION','RISK','MINUTES','ATTACHMENT')),
  record_id   uuid,
  event_type  text not null,
  actor_id    uuid references users(id),
  details     jsonb,
  remarks     text,
  occurred_at timestamptz not null default app_now()
);
create index okr_session_events_session_idx on okr_session_events (session_id, seq);
create index okr_session_events_record_idx on okr_session_events (record_type, record_id, seq);
create trigger okr_session_events_immutable before update or delete on okr_session_events for each row execute function forbid_mutation();

create or replace function okr_log(p_actor uuid, p_session uuid, p_type text, p_id uuid, p_event text, p_details jsonb default null, p_remarks text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_bu uuid;
begin
  insert into okr_session_events (session_id, record_type, record_id, event_type, actor_id, details, remarks) values (p_session, p_type, p_id, p_event, p_actor, p_details, p_remarks);
  select business_unit_id into v_bu from okr_sessions where id = p_session;
  perform write_audit(p_actor, 'OKR_SESSION_' || p_event, 'okr_' || lower(p_type), coalesce(p_id, p_session)::text, null,
                      coalesce(p_details, '{}'::jsonb) || jsonb_build_object('session_id', p_session), p_remarks, v_bu);
end $$;

-- ------------------------------------------------------------------ visibility (the single definition used by RLS and by the functions)
create or replace function okr_session_visible_to(p_actor uuid, p_session uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from okr_sessions s
    where s.id = p_session
      and actor_has_permission(p_actor, 'session_notes.view')
      and (actor_has_permission(p_actor, 'session_notes.view_all')
           or (s.business_unit_id is not null and s.business_unit_id = actor_bu(p_actor))
           or s.facilitator_id = p_actor or s.created_by = p_actor
           or exists (select 1 from okr_session_participants p where p.session_id = s.id and p.user_id = p_actor and p.removed_at is null)));
$$;

-- who may read one note: the author and the facilitator always; SHARED notes by anyone who sees the session; MANAGEMENT notes by those who see every unit; CONFIDENTIAL by nobody else
create or replace function okr_note_visible_to(p_actor uuid, p_session uuid, p_visibility text, p_author uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select okr_session_visible_to(p_actor, p_session) and (
    p_visibility = 'SHARED' or p_author = p_actor
    or exists (select 1 from okr_sessions s where s.id = p_session and s.facilitator_id = p_actor)
    or (p_visibility = 'MANAGEMENT' and actor_has_permission(p_actor, 'session_notes.view_all')));
$$;

create or replace function auth_okr_session_visible(p_session uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$ select auth_aal_satisfied() and okr_session_visible_to(auth.uid(), p_session); $$;
create or replace function auth_okr_note_visible(p_session uuid, p_visibility text, p_author uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$ select auth_aal_satisfied() and okr_note_visible_to(auth.uid(), p_session, p_visibility, p_author); $$;

do $$
declare v_def text; a text := '''auth_has_any'',';
begin
  v_def := pg_get_functiondef('lock_down_function_grants()'::regprocedure);
  if position(a in v_def) = 0 then raise exception 'lock_down_function_grants changed'; end if;
  if position('auth_okr_session_visible' in v_def) > 0 then return; end if;
  execute replace(v_def, a, '''auth_okr_session_visible'',''auth_okr_note_visible'',' || a);
end $$;

-- ------------------------------------------------------------------ row-level security (reads only; there is no insert, update or delete grant for signed-in people)
alter table okr_session_types        enable row level security;
alter table okr_sessions             enable row level security;
alter table okr_session_participants enable row level security;
alter table okr_session_notes        enable row level security;
alter table okr_session_note_versions enable row level security;
alter table okr_session_links        enable row level security;
alter table okr_session_events       enable row level security;
alter table okr_counters             enable row level security;
alter table okr_idempotency          enable row level security;
grant select on okr_session_types, okr_sessions, okr_session_participants, okr_session_notes, okr_session_note_versions, okr_session_links, okr_session_events to authenticated;

create policy read_types on okr_session_types for select to authenticated using ((select auth_has_any(array['session_notes.view','session_notes.configure'])));
create policy read_visible on okr_sessions for select to authenticated using ((select auth_okr_session_visible(id)));
create policy read_visible on okr_session_participants for select to authenticated using ((select auth_okr_session_visible(session_id)));
create policy read_visible on okr_session_notes for select to authenticated using ((select auth_okr_note_visible(session_id, visibility, author_id)));
create policy read_visible on okr_session_note_versions for select to authenticated using (exists (select 1 from okr_session_notes n where n.id = note_id));
create policy read_visible on okr_session_links for select to authenticated using (
  (select auth_okr_session_visible(session_id)) and (owner_type <> 'NOTE' or exists (select 1 from okr_session_notes n where n.id = owner_id)));
create policy read_visible on okr_session_events for select to authenticated using (
  (select auth_okr_session_visible(session_id)) and (record_type <> 'NOTE' or exists (select 1 from okr_session_notes n where n.id = record_id)));

-- ------------------------------------------------------------------ small guards
create or replace function okr_get_session(p_actor uuid, p_session uuid, p_lock boolean default false) returns okr_sessions
language plpgsql security definer set search_path = public, pg_temp as $$
declare s okr_sessions;
begin
  if p_lock then select * into s from okr_sessions where id = p_session for update; else select * into s from okr_sessions where id = p_session; end if;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not okr_session_visible_to(p_actor, p_session) then raise exception 'BU_SCOPE_DENIED'; end if;
  return s;
end $$;

-- the session's own people: creator, facilitator, or someone who finalises minutes
create or replace function okr_runs_session(p_actor uuid, s okr_sessions) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select s.facilitator_id = p_actor or s.created_by = p_actor or actor_has_permission(p_actor, 'session_notes.finalise');
$$;

create or replace function okr_assert_open(s okr_sessions) returns void
language plpgsql stable as $$
begin
  if s.status = 'ARCHIVED' then raise exception 'SESSION_READ_ONLY' using detail = 'this session is archived; restore it first'; end if;
end $$;

create or replace function okr_check_version(p_expected int, p_current int) returns void
language plpgsql immutable as $$
begin
  if p_expected is not null and p_expected <> p_current then raise exception 'VERSION_CONFLICT' using detail = p_current::text; end if;
end $$;

create or replace function okr_clean(p_text text, p_max int, p_what text, p_required boolean default false) returns text
language plpgsql immutable as $$
declare t text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if t is null then
    if p_required and p_what in ('the reason', 'the justification') then raise exception 'REASON_REQUIRED' using detail = 'a reason is required'; end if;
    if p_required then raise exception 'VALIDATION_ERROR' using detail = p_what || ' is required'; end if;
    return null;
  end if;
  if char_length(t) > p_max then raise exception 'VALIDATION_ERROR' using detail = p_what || ' is limited to ' || p_max || ' characters'; end if;
  return t;
end $$;

-- ------------------------------------------------------------------ session types
create or replace function save_okr_session_type(p_actor uuid, p_id uuid, p_code text, p_name text, p_description text, p_sort int, p_active boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := p_id; v_name text := okr_clean(p_name, 100, 'a name', true);
begin
  perform require_permission(p_actor, 'session_notes.configure');
  if v_id is null then
    if p_code is null or p_code !~ '^[A-Z][A-Z0-9_]{1,39}$' then raise exception 'VALIDATION_ERROR' using detail = 'the code is capital letters, digits and underscores (2 to 40 characters)'; end if;
    insert into okr_session_types (code, name, description, sort_order, active) values (p_code, v_name, okr_clean(p_description, 500, 'the description'), coalesce(p_sort, 100), coalesce(p_active, true)) returning id into v_id;
  else
    update okr_session_types set name = v_name, description = okr_clean(p_description, 500, 'the description'), sort_order = coalesce(p_sort, sort_order), active = coalesce(p_active, active), updated_at = app_now() where id = v_id;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  perform write_audit(p_actor, 'OKR_SESSION_TYPE_SAVED', 'okr_session_type', v_id::text, null, jsonb_build_object('name', v_name, 'active', p_active, 'code', p_code));
  return v_id;
exception when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'that session type code already exists';
end $$;

-- ------------------------------------------------------------------ sessions
-- p_participants: [{ "user_id": uuid, "role": "ATTENDEE" }]
create or replace function create_okr_session(
  p_actor uuid, p_title text, p_type uuid, p_date date, p_week uuid, p_bu uuid, p_governance uuid,
  p_starts timestamptz, p_ends timestamptz, p_facilitator uuid, p_description text, p_agenda text, p_participants jsonb, p_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev jsonb; v_id uuid := gen_random_uuid(); v_ref text; v_quarter uuid; v_fac uuid := coalesce(p_facilitator, p_actor); v_res jsonb; x jsonb; v_role text; v_user uuid;
begin
  perform require_permission(p_actor, 'session_notes.create');
  v_prev := okr_idem(p_actor, p_key, 'create_okr_session'); if v_prev is not null then return v_prev; end if;
  if p_date is null then raise exception 'VALIDATION_ERROR' using detail = 'the session date is required'; end if;
  if not exists (select 1 from okr_session_types where id = p_type and active) then raise exception 'VALIDATION_ERROR' using detail = 'choose an active session type'; end if;
  if p_bu is null then
    if not actor_has_permission(p_actor, 'session_notes.view_all') then raise exception 'BU_SCOPE_DENIED' using detail = 'an organisation-wide session needs access to every unit'; end if;
  else
    if not exists (select 1 from business_units where id = p_bu) then raise exception 'NOT_FOUND' using detail = 'business unit'; end if;
    if not actor_has_permission(p_actor, 'session_notes.view_all') and p_bu is distinct from actor_bu(p_actor) then raise exception 'BU_SCOPE_DENIED'; end if;
    perform assert_unit_scope(p_actor, p_bu);
  end if;
  if p_week is not null then
    select quarter_id into v_quarter from reporting_weeks where id = p_week;
    if not found then raise exception 'NOT_FOUND' using detail = 'reporting week'; end if;
  else
    select id into v_quarter from quarters where starts_on <= p_date and ends_on >= p_date limit 1;     -- may be null: a session need not belong to a quarter
  end if;
  if p_governance is not null and not exists (select 1 from governance_sessions where id = p_governance) then raise exception 'NOT_FOUND' using detail = 'attendance session'; end if;
  if not exists (select 1 from users where id = v_fac and status = 'ACTIVE') then raise exception 'VALIDATION_ERROR' using detail = 'the facilitator must be an active user'; end if;
  if not actor_has_permission(v_fac, 'session_notes.view') then raise exception 'VALIDATION_ERROR' using detail = 'the facilitator''s role does not give access to session notes'; end if;
  v_ref := okr_next_ref('SESSION', 'OKS', extract(year from p_date)::int);
  insert into okr_sessions (id, reference, title, session_type_id, quarter_id, reporting_week_id, business_unit_id, governance_session_id, session_date, starts_at, ends_at,
                            facilitator_id, description, agenda, created_by)
  values (v_id, v_ref, okr_clean(p_title, 200, 'a title', true), p_type, v_quarter, p_week, p_bu, p_governance, p_date, p_starts, p_ends, v_fac,
          okr_clean(p_description, 4000, 'the description'), okr_clean(p_agenda, 20000, 'the agenda'), p_actor);
  insert into okr_session_participants (session_id, user_id, role, added_by) values (v_id, v_fac, 'FACILITATOR', p_actor);
  for x in select * from jsonb_array_elements(okr_arr(p_participants)) loop
    v_user := (x ->> 'user_id')::uuid; v_role := coalesce(x ->> 'role', 'ATTENDEE');
    if v_user = v_fac then continue; end if;
    if v_role not in ('PRESENTER','BU_LEAD','ATTENDEE','OBSERVER') then raise exception 'VALIDATION_ERROR' using detail = 'unknown participant role'; end if;
    if not exists (select 1 from users where id = v_user and status = 'ACTIVE') then raise exception 'VALIDATION_ERROR' using detail = 'participants must be active users'; end if;
    if not actor_has_permission(v_user, 'session_notes.view') then raise exception 'VALIDATION_ERROR' using detail = 'a participant''s role does not give access to session notes'; end if;
    insert into okr_session_participants (session_id, user_id, role, added_by) values (v_id, v_user, v_role, p_actor) on conflict do nothing;
  end loop;
  perform okr_log(p_actor, v_id, 'SESSION', v_id, 'CREATED', jsonb_build_object('reference', v_ref, 'business_unit_id', p_bu, 'reporting_week_id', p_week, 'session_date', p_date));
  v_res := jsonb_build_object('id', v_id, 'reference', v_ref, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

create or replace function update_okr_session(
  p_actor uuid, p_session uuid, p_expected_version int, p_title text, p_type uuid, p_date date, p_starts timestamptz, p_ends timestamptz,
  p_facilitator uuid, p_description text, p_agenda text, p_governance uuid, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s okr_sessions; v_fac uuid; v_reason text := okr_clean(p_reason, 2000, 'the reason');
begin
  perform require_permission(p_actor, 'session_notes.update');
  s := okr_get_session(p_actor, p_session, true);
  if not okr_runs_session(p_actor, s) then raise exception 'PERMISSION_DENIED' using detail = 'only the facilitator, the creator or a finaliser can change the session'; end if;
  perform okr_assert_open(s);
  perform okr_check_version(p_expected_version, s.version);
  if s.status = 'COMPLETED' and v_reason is null then raise exception 'REASON_REQUIRED' using detail = 'say why a completed session is being changed'; end if;
  v_fac := coalesce(p_facilitator, s.facilitator_id);
  if v_fac <> s.facilitator_id then
    if not exists (select 1 from users where id = v_fac and status = 'ACTIVE') or not actor_has_permission(v_fac, 'session_notes.view') then raise exception 'VALIDATION_ERROR' using detail = 'the facilitator must be an active user with access to session notes'; end if;
    insert into okr_session_participants (session_id, user_id, role, added_by) values (s.id, v_fac, 'FACILITATOR', p_actor)
      on conflict (session_id, user_id) do update set role = 'FACILITATOR', removed_at = null, removed_by = null;
    update okr_session_participants set role = 'ATTENDEE' where session_id = s.id and user_id = s.facilitator_id;
  end if;
  if p_type is not null and not exists (select 1 from okr_session_types where id = p_type and (active or id = s.session_type_id)) then raise exception 'VALIDATION_ERROR' using detail = 'choose an active session type'; end if;
  update okr_sessions set title = coalesce(okr_clean(p_title, 200, 'a title'), title), session_type_id = coalesce(p_type, session_type_id), session_date = coalesce(p_date, session_date),
         starts_at = p_starts, ends_at = p_ends, facilitator_id = v_fac, description = okr_clean(p_description, 4000, 'the description'), agenda = okr_clean(p_agenda, 20000, 'the agenda'),
         governance_session_id = p_governance, version = version + 1, updated_at = app_now()
   where id = s.id;
  perform okr_log(p_actor, s.id, 'SESSION', s.id, 'UPDATED', jsonb_build_object('from_version', s.version, 'title', s.title, 'session_date', s.session_date, 'facilitator_id', s.facilitator_id), v_reason);
  return jsonb_build_object('id', s.id, 'version', s.version + 1);
end $$;

-- add or remove one participant (removal keeps the row and the date)
create or replace function set_okr_session_participant(p_actor uuid, p_session uuid, p_user uuid, p_role text, p_remove boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s okr_sessions;
begin
  perform require_permission(p_actor, 'session_notes.update');
  s := okr_get_session(p_actor, p_session, true);
  if not okr_runs_session(p_actor, s) then raise exception 'PERMISSION_DENIED'; end if;
  perform okr_assert_open(s);
  if p_user = s.facilitator_id and coalesce(p_remove, false) then raise exception 'VALIDATION_ERROR' using detail = 'the facilitator cannot be removed; change the facilitator first'; end if;
  if coalesce(p_remove, false) then
    update okr_session_participants set removed_at = app_now(), removed_by = p_actor where session_id = s.id and user_id = p_user and removed_at is null;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform okr_log(p_actor, s.id, 'SESSION', s.id, 'PARTICIPANT_REMOVED', jsonb_build_object('user_id', p_user));
  else
    if coalesce(p_role, 'ATTENDEE') not in ('PRESENTER','BU_LEAD','ATTENDEE','OBSERVER') then raise exception 'VALIDATION_ERROR' using detail = 'unknown participant role'; end if;
    if not exists (select 1 from users where id = p_user and status = 'ACTIVE') or not actor_has_permission(p_user, 'session_notes.view') then
      raise exception 'VALIDATION_ERROR' using detail = 'a participant must be an active user whose role gives access to session notes'; end if;
    insert into okr_session_participants (session_id, user_id, role, added_by) values (s.id, p_user, coalesce(p_role, 'ATTENDEE'), p_actor)
      on conflict (session_id, user_id) do update set role = excluded.role, removed_at = null, removed_by = null;
    perform okr_log(p_actor, s.id, 'SESSION', s.id, 'PARTICIPANT_ADDED', jsonb_build_object('user_id', p_user, 'role', coalesce(p_role, 'ATTENDEE')));
  end if;
  update okr_sessions set version = version + 1, updated_at = app_now() where id = s.id;
end $$;

-- DRAFT -> IN_PROGRESS -> COMPLETED -> ARCHIVED; COMPLETED -> IN_PROGRESS (reopen, with a reason); DRAFT -> ARCHIVED; ARCHIVED -> where it was archived from
create or replace function transition_okr_session(p_actor uuid, p_session uuid, p_to text, p_reason text, p_expected_version int, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s okr_sessions; v_prev jsonb; v_reason text := okr_clean(p_reason, 2000, 'the reason'); v_open int; v_res jsonb; v_to text := p_to;
begin
  v_prev := okr_idem(p_actor, p_key, 'transition_okr_session'); if v_prev is not null then return v_prev; end if;
  s := okr_get_session(p_actor, p_session, true);
  perform okr_check_version(p_expected_version, s.version);
  if v_to = 'RESTORED' then
    if s.status <> 'ARCHIVED' then raise exception 'INVALID_STATE_TRANSITION'; end if;
    v_to := coalesce(s.archived_from, 'COMPLETED');
  end if;
  if (s.status, v_to) not in (('DRAFT','IN_PROGRESS'),('IN_PROGRESS','COMPLETED'),('COMPLETED','IN_PROGRESS'),('COMPLETED','ARCHIVED'),('DRAFT','ARCHIVED'),('ARCHIVED','DRAFT'),('ARCHIVED','COMPLETED')) then
    raise exception 'INVALID_STATE_TRANSITION' using detail = s.status || ' to ' || v_to;
  end if;
  if v_to = 'ARCHIVED' or s.status = 'ARCHIVED' then
    perform require_permission(p_actor, 'session_notes.archive');
  else
    perform require_permission(p_actor, 'session_notes.update');
    if not okr_runs_session(p_actor, s) then raise exception 'PERMISSION_DENIED' using detail = 'only the facilitator, the creator or a finaliser can move the session on'; end if;
  end if;
  perform assert_unit_scope(p_actor, s.business_unit_id);
  if (s.status = 'COMPLETED' and v_to = 'IN_PROGRESS') and v_reason is null then raise exception 'REASON_REQUIRED' using detail = 'say why a completed session is being reopened'; end if;
  update okr_sessions set status = v_to, version = version + 1, updated_at = app_now(),
         started_at = case when v_to = 'IN_PROGRESS' and started_at is null then app_now() else started_at end,
         completed_at = case when v_to = 'COMPLETED' and s.status = 'IN_PROGRESS' then app_now() else completed_at end,
         completed_by = case when v_to = 'COMPLETED' and s.status = 'IN_PROGRESS' then p_actor else completed_by end,
         archived_at = case when v_to = 'ARCHIVED' then app_now() else null end,
         archived_by = case when v_to = 'ARCHIVED' then p_actor else null end,
         archived_from = case when v_to = 'ARCHIVED' then s.status else null end
   where id = s.id;
  select count(*) into v_open from okr_session_actions a where a.origin_session_id = s.id and a.status in ('OPEN','IN_PROGRESS','BLOCKED');
  perform okr_log(p_actor, s.id, 'SESSION', s.id, 'STATUS_' || v_to, jsonb_build_object('from', s.status, 'to', v_to, 'open_actions', v_open), v_reason);
  v_res := jsonb_build_object('id', s.id, 'status', v_to, 'version', s.version + 1, 'open_actions', v_open, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

-- ------------------------------------------------------------------ link targets
create or replace function okr_link_target(p_type text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  r := case p_type
    when 'ANNUAL_THEME' then (select jsonb_build_object('label', 'Annual theme ' || year || ': ' || theme, 'bu', null) from annual_themes where id = p_id)
    when 'QUARTER' then (select jsonb_build_object('label', 'Q' || quarter_number || ' ' || year, 'bu', null) from quarters where id = p_id)
    when 'OBJECTIVE' then (select jsonb_build_object('label', 'Objective Q' || q.quarter_number || ' ' || q.year || ': ' || o.title, 'bu', null) from quarterly_objectives o join quarters q on q.id = o.quarter_id where o.id = p_id)
    when 'KEY_RESULT' then (select jsonb_build_object('label', 'KR ' || code || ': ' || title, 'bu', null) from key_results where id = p_id)
    when 'SUB_KEY_RESULT' then (select jsonb_build_object('label', 'Sub-KR ' || code || ': ' || title, 'bu', null) from sub_key_results where id = p_id)
    when 'BU_GOAL' then (select jsonb_build_object('label', 'BU goal: ' || title, 'bu', business_unit_id) from bu_goals where id = p_id)
    when 'WEEKLY_GOAL' then (select jsonb_build_object('label', 'Goal: ' || title, 'bu', business_unit_id) from smart_goals where id = p_id)
    when 'TASK' then (select jsonb_build_object('label', 'Task: ' || left(description, 120), 'bu', business_unit_id) from tasks where id = p_id)
    when 'WEEKLY_REPORT' then (select jsonb_build_object('label', 'Weekly report, week ' || w.week_number || ' ' || w.week_year, 'bu', r.business_unit_id) from weekly_reports r join reporting_weeks w on w.id = r.reporting_week_id where r.id = p_id)
    else null end;
  return r;
end $$;

-- links one record (note, decision, action or risk) to an OKR component; linking never changes the component
create or replace function okr_add_link(p_actor uuid, s okr_sessions, p_owner_type text, p_owner_id uuid, p_target_type text, p_target_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t jsonb := okr_link_target(p_target_type, p_target_id); v_bu uuid; v_id uuid;
begin
  if t is null then raise exception 'LINK_TARGET_INVALID' using detail = 'that OKR component does not exist'; end if;
  v_bu := nullif(t ->> 'bu', '')::uuid;
  if v_bu is not null and s.business_unit_id is not null and v_bu <> s.business_unit_id then
    raise exception 'LINK_TARGET_INVALID' using detail = 'that goal, task or report belongs to another business unit than this session';
  end if;
  if v_bu is not null and s.business_unit_id is null and not actor_has_permission(p_actor, 'session_notes.view_all') then raise exception 'BU_SCOPE_DENIED'; end if;
  insert into okr_session_links (session_id, owner_type, owner_id, target_type, target_id, label, target_bu_id, created_by)
  values (s.id, p_owner_type, p_owner_id, p_target_type, p_target_id, left(t ->> 'label', 300), v_bu, p_actor)
  on conflict (owner_type, owner_id, target_type, target_id) where removed_at is null do nothing
  returning id into v_id;
  if v_id is not null then
    perform okr_log(p_actor, s.id, p_owner_type, p_owner_id, 'LINK_ADDED', jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id, 'label', left(t ->> 'label', 300)));
  end if;
  return v_id;
end $$;

-- p_remove false: add; true: remove. The owner's own permission rules apply (see the callers below and in part 2).
create or replace function set_okr_note_link(p_actor uuid, p_note uuid, p_target_type text, p_target_id uuid, p_remove boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n okr_session_notes; s okr_sessions;
begin
  perform require_permission(p_actor, 'session_notes.update');
  select * into n from okr_session_notes where id = p_note for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  s := okr_get_session(p_actor, n.session_id);
  if not okr_note_visible_to(p_actor, n.session_id, n.visibility, n.author_id) then raise exception 'BU_SCOPE_DENIED'; end if;
  if n.author_id <> p_actor and not okr_runs_session(p_actor, s) then raise exception 'PERMISSION_DENIED' using detail = 'only the author, the facilitator or a finaliser can change a note''s links'; end if;
  perform okr_assert_open(s);
  if coalesce(p_remove, false) then
    update okr_session_links set removed_at = app_now(), removed_by = p_actor where owner_type = 'NOTE' and owner_id = n.id and target_type = p_target_type and target_id = p_target_id and removed_at is null;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform okr_log(p_actor, s.id, 'NOTE', n.id, 'LINK_REMOVED', jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id));
  else
    perform okr_add_link(p_actor, s, 'NOTE', n.id, p_target_type, p_target_id);
  end if;
end $$;

-- ------------------------------------------------------------------ notes
-- p_links: [{ "target_type": "KEY_RESULT", "target_id": uuid }]. p_client_key makes a retried create return the same note.
create or replace function create_okr_note(
  p_actor uuid, p_session uuid, p_category text, p_title text, p_content text, p_visibility text, p_links jsonb, p_client_key text, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s okr_sessions; v_id uuid; v_old uuid; x jsonb; v_reason text := okr_clean(p_reason, 2000, 'the reason');
begin
  perform require_permission(p_actor, 'session_notes.create');
  if p_client_key is not null then
    select id into v_old from okr_session_notes where author_id = p_actor and client_key = p_client_key;
    if found then return jsonb_build_object('id', v_old, 'replayed', true); end if;
  end if;
  s := okr_get_session(p_actor, p_session);
  perform okr_assert_open(s);
  if s.status = 'COMPLETED' and v_reason is null then raise exception 'REASON_REQUIRED' using detail = 'say why a note is being added to a completed session'; end if;
  insert into okr_session_notes (session_id, category, title, content, visibility, author_id, last_edited_by, client_key)
  values (s.id, coalesce(p_category, 'GENERAL_DISCUSSION'), okr_clean(p_title, 200, 'the title'), coalesce(p_content, ''), coalesce(p_visibility, 'SHARED'), p_actor, p_actor, p_client_key)
  returning id into v_id;
  for x in select * from jsonb_array_elements(okr_arr(p_links)) loop
    perform okr_add_link(p_actor, s, 'NOTE', v_id, x ->> 'target_type', (x ->> 'target_id')::uuid);
  end loop;
  perform okr_log(p_actor, s.id, 'NOTE', v_id, case when s.status = 'COMPLETED' then 'ADDED_AFTER_COMPLETION' else 'CREATED' end,
                  jsonb_build_object('category', coalesce(p_category, 'GENERAL_DISCUSSION'), 'visibility', coalesce(p_visibility, 'SHARED')), v_reason);
  return jsonb_build_object('id', v_id, 'version', 1, 'replayed', false);
exception when unique_violation then
  select id into v_old from okr_session_notes where author_id = p_actor and client_key = p_client_key;
  if v_old is null then raise; end if;
  return jsonb_build_object('id', v_old, 'replayed', true);
end $$;

-- the autosave target. p_expected_version is mandatory: a second editor gets VERSION_CONFLICT carrying the version now on record.
create or replace function update_okr_note(
  p_actor uuid, p_note uuid, p_expected_version int, p_category text, p_title text, p_content text, p_visibility text, p_reason text, p_keep_replaced boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n okr_session_notes; s okr_sessions; v_reason text := okr_clean(p_reason, 2000, 'the reason'); v_kind text; v_last timestamptz; v_content text;
  v_cat text; v_vis text; v_title text;
begin
  perform require_permission(p_actor, 'session_notes.update');
  if p_expected_version is null then raise exception 'VALIDATION_ERROR' using detail = 'the version you started from is required'; end if;
  select * into n from okr_session_notes where id = p_note for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  s := okr_get_session(p_actor, n.session_id);
  if not okr_note_visible_to(p_actor, n.session_id, n.visibility, n.author_id) then raise exception 'BU_SCOPE_DENIED'; end if;
  if n.author_id <> p_actor and not okr_runs_session(p_actor, s) then raise exception 'PERMISSION_DENIED' using detail = 'only the author, the facilitator or a finaliser can edit this note'; end if;
  perform okr_assert_open(s);
  if n.status = 'ARCHIVED' then raise exception 'SESSION_READ_ONLY' using detail = 'this note is archived; restore it first'; end if;
  perform okr_check_version(p_expected_version, n.version);
  v_content := coalesce(p_content, n.content);      -- a save that does not send the text keeps the text
  v_cat := coalesce(p_category, n.category); v_vis := coalesce(p_visibility, n.visibility); v_title := case when p_title is null then n.title else okr_clean(p_title, 200, 'the title') end;
  if v_vis <> n.visibility and n.author_id <> p_actor and not okr_runs_session(p_actor, s) then raise exception 'PERMISSION_DENIED'; end if;
  if v_cat = n.category and v_vis = n.visibility and v_content = n.content and v_title is not distinct from n.title then
    return jsonb_build_object('id', n.id, 'version', n.version, 'unchanged', true);       -- a repeated autosave of the same text changes nothing
  end if;
  v_kind := case when s.status = 'COMPLETED' then 'AMENDED_AFTER_COMPLETION' when v_vis <> n.visibility then 'RECLASSIFIED' else 'EDITED' end;
  if s.status = 'COMPLETED' and v_reason is null then raise exception 'REASON_REQUIRED' using detail = 'say why a note of a completed session is being changed'; end if;
  -- the state being replaced is kept when it had settled (60 s), was written by someone else, the editor is overwriting after a conflict (p_keep_replaced), or the change is an amendment/reclassification
  select max(superseded_at) into v_last from okr_session_note_versions where note_id = n.id;
  if coalesce(p_keep_replaced, false) or v_kind <> 'EDITED' or n.last_edited_by <> p_actor or n.updated_at <= app_now() - interval '60 seconds' or v_last is null and n.version = 1 then
    insert into okr_session_note_versions (note_id, version, category, title, content, visibility, status, saved_by, saved_at, superseded_by, change_kind, reason)
    values (n.id, n.version, n.category, n.title, n.content, n.visibility, n.status, n.last_edited_by, n.updated_at, p_actor, v_kind, v_reason);
  end if;
  update okr_session_notes set category = v_cat, title = v_title, content = v_content, visibility = v_vis, last_edited_by = p_actor, version = version + 1, updated_at = app_now() where id = n.id;
  if v_kind <> 'EDITED' then
    perform okr_log(p_actor, s.id, 'NOTE', n.id, case v_kind when 'RECLASSIFIED' then 'RECLASSIFIED' else 'AMENDED' end, jsonb_build_object('from_version', n.version), v_reason);
  end if;
  return jsonb_build_object('id', n.id, 'version', n.version + 1, 'updated_at', app_now());
end $$;

create or replace function archive_okr_note(p_actor uuid, p_note uuid, p_restore boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n okr_session_notes; s okr_sessions; v_reason text := okr_clean(p_reason, 2000, 'the reason', true);
begin
  perform require_permission(p_actor, 'session_notes.update');
  select * into n from okr_session_notes where id = p_note for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  s := okr_get_session(p_actor, n.session_id);
  if not okr_note_visible_to(p_actor, n.session_id, n.visibility, n.author_id) then raise exception 'BU_SCOPE_DENIED'; end if;
  if n.author_id <> p_actor and not okr_runs_session(p_actor, s) then raise exception 'PERMISSION_DENIED'; end if;
  perform okr_assert_open(s);
  if coalesce(p_restore, false) then
    if n.status <> 'ARCHIVED' then raise exception 'INVALID_STATE_TRANSITION'; end if;
    insert into okr_session_note_versions (note_id, version, category, title, content, visibility, status, saved_by, saved_at, superseded_by, change_kind, reason)
      values (n.id, n.version, n.category, n.title, n.content, n.visibility, n.status, n.last_edited_by, n.updated_at, p_actor, 'RESTORED', v_reason);
    update okr_session_notes set status = 'ACTIVE', archived_at = null, archived_by = null, archive_reason = null, version = version + 1, last_edited_by = p_actor, updated_at = app_now() where id = n.id;
    perform okr_log(p_actor, s.id, 'NOTE', n.id, 'RESTORED', null, v_reason);
  else
    if n.status = 'ARCHIVED' then raise exception 'INVALID_STATE_TRANSITION'; end if;
    insert into okr_session_note_versions (note_id, version, category, title, content, visibility, status, saved_by, saved_at, superseded_by, change_kind, reason)
      values (n.id, n.version, n.category, n.title, n.content, n.visibility, n.status, n.last_edited_by, n.updated_at, p_actor, 'ARCHIVED', v_reason);
    update okr_session_notes set status = 'ARCHIVED', archived_at = app_now(), archived_by = p_actor, archive_reason = v_reason, version = version + 1, last_edited_by = p_actor, updated_at = app_now() where id = n.id;
    perform okr_log(p_actor, s.id, 'NOTE', n.id, 'ARCHIVED', null, v_reason);
  end if;
  return jsonb_build_object('id', n.id, 'version', n.version + 1);
end $$;

-- ------------------------------------------------------------------ email: session events are optional emails (a person can switch them off in their preferences)
insert into email_event_types (event_type, mandatory, description) values
  ('SESSION_ACTION_ASSIGNED',   false, 'An OKR session action item was assigned to you'),
  ('SESSION_ACTION_REASSIGNED', false, 'An OKR session action item was reassigned'),
  ('SESSION_ACTION_BLOCKED',    false, 'An OKR session action item was marked blocked'),
  ('SESSION_ACTION_DUE',        false, 'An OKR session action item is due soon'),
  ('SESSION_ACTION_OVERDUE',    false, 'An OKR session action item is overdue'),
  ('SESSION_ACTION_FOLLOW_UP',  false, 'A previous commitment needs an update'),
  ('SESSION_ACTION_COMPLETED',  false, 'An OKR session action item was completed'),
  ('SESSION_ACTION_VERIFIED',   false, 'The completion of an OKR session action item was verified or sent back'),
  ('SESSION_DECISION',          false, 'A decision was recorded or changed in an OKR session'),
  ('SESSION_MINUTES_REVIEW',    false, 'Session minutes were submitted for review'),
  ('SESSION_MINUTES_FINAL',     false, 'Session minutes were finalised')
on conflict do nothing;

select lock_down_function_grants();
