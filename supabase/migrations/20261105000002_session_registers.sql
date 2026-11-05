-- OKR Session Notes & Meeting Intelligence, part 2 of 3: the Decisions, Action items and Risks registers, and carrying open items into later sessions.
--
-- Rules this migration builds in:
--  * A discussion note is not a decision, an action or a risk. A decision is PROPOSED until a person holding session_decisions.approve approves it; only then is it formal.
--    An approved decision is never edited: it is superseded by a new approved one (the old one is kept, marked SUPERSEDED, and links forward).
--  * An action item is one row for its whole life. Carrying it into a later session records a review of the SAME row (no copy), so there are no duplicates and
--    the history of the commitment is complete. Completing an action never touches a goal, task, report, score or compliance record.
--  * A risk or blocker is a formal register record (session_risks.manage). An observation stays a note until someone with that authority records it.
--  * Every change is one function: permission, scope, state, optimistic version, audit and notification in one transaction. Nothing is deleted.

-- ------------------------------------------------------------------ decisions
create table okr_session_decisions (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique,
  session_id       uuid not null references okr_sessions(id) on delete restrict,
  title            text not null check (btrim(title) <> '' and char_length(title) <= 300),
  description      text not null check (btrim(description) <> '' and char_length(description) <= 10000),
  background       text check (background is null or char_length(background) <= 10000),
  justification    text check (justification is null or char_length(justification) <= 10000),
  decision_date    date not null,
  status           text not null default 'PROPOSED' check (status in ('PROPOSED','APPROVED','REJECTED','SUPERSEDED','WITHDRAWN')),
  decided_by       uuid references users(id),                -- the authority who approved or rejected
  decided_at       timestamptz,
  authority_note   text check (authority_note is null or char_length(authority_note) <= 300),   -- e.g. "Management committee, 4 Nov"
  involved_user_ids uuid[] not null default '{}',
  affected_bu_id   uuid references business_units(id),
  expected_outcome text check (expected_outcome is null or char_length(expected_outcome) <= 5000),
  follow_up        text check (follow_up is null or char_length(follow_up) <= 5000),
  source_note_id   uuid references okr_session_notes(id),
  supersedes_id    uuid references okr_session_decisions(id),
  superseded_by_id uuid references okr_session_decisions(id),
  status_reason    text,
  client_key       text check (client_key is null or char_length(client_key) between 8 and 100),
  version          int not null default 1,
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default app_now(),
  updated_at       timestamptz not null default app_now(),
  check ((status in ('APPROVED','REJECTED','SUPERSEDED')) = (decided_by is not null)),
  check ((status = 'SUPERSEDED') = (superseded_by_id is not null))
);
create index okr_session_decisions_session_idx on okr_session_decisions (session_id);
create index okr_session_decisions_status_idx on okr_session_decisions (status, decision_date desc);
create index okr_session_decisions_bu_idx on okr_session_decisions (affected_bu_id);
create unique index okr_session_decisions_client_key_idx on okr_session_decisions (created_by, client_key) where client_key is not null;
create index okr_session_decisions_fts_idx on okr_session_decisions using gin (to_tsvector('simple', title || ' ' || description));

-- ------------------------------------------------------------------ action items
create table okr_session_actions (
  id                   uuid primary key default gen_random_uuid(),
  reference            text not null unique,
  origin_session_id    uuid not null references okr_sessions(id) on delete restrict,
  source_note_id       uuid references okr_session_notes(id),
  source_decision_id   uuid references okr_session_decisions(id),
  description          text not null check (btrim(description) <> '' and char_length(description) <= 5000),
  business_unit_id     uuid not null references business_units(id),     -- the responsible BU
  assignee_id          uuid not null references users(id),
  priority             text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH','CRITICAL')),
  assigned_at          timestamptz not null default app_now(),
  due_date             date not null,
  original_due_date    date not null,
  extensions           int not null default 0,
  status               text not null default 'OPEN' check (status in ('OPEN','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED')),
  progress_note        text check (progress_note is null or char_length(progress_note) <= 5000),
  blocked_reason       text check (blocked_reason is null or char_length(blocked_reason) <= 2000),
  completed_at         timestamptz,
  completed_by         uuid references users(id),
  completion_remarks   text check (completion_remarks is null or char_length(completion_remarks) <= 5000),
  requires_verification boolean not null default false,
  evidence_required    boolean not null default false,
  verification_status  text not null default 'NOT_REQUIRED' check (verification_status in ('NOT_REQUIRED','PENDING','VERIFIED','REJECTED')),
  verified_by          uuid references users(id),
  verified_at          timestamptz,
  escalated_at         timestamptz,
  escalated_by         uuid references users(id),
  escalation_reason    text,
  client_key           text check (client_key is null or char_length(client_key) between 8 and 100),
  version              int not null default 1,
  created_by           uuid not null references users(id),
  created_at           timestamptz not null default app_now(),
  updated_at           timestamptz not null default app_now(),
  check ((status = 'COMPLETED') = (completed_at is not null)),
  check (due_date >= original_due_date),
  check (requires_verification or verification_status = 'NOT_REQUIRED')
);
create index okr_session_actions_session_idx on okr_session_actions (origin_session_id);
create index okr_session_actions_bu_status_idx on okr_session_actions (business_unit_id, status);
create index okr_session_actions_assignee_idx on okr_session_actions (assignee_id, status);
create index okr_session_actions_due_idx on okr_session_actions (due_date) where status in ('OPEN','IN_PROGRESS','BLOCKED');
create unique index okr_session_actions_client_key_idx on okr_session_actions (created_by, client_key) where client_key is not null;
create index okr_session_actions_fts_idx on okr_session_actions using gin (to_tsvector('simple', description));

-- ------------------------------------------------------------------ risks, blockers and issues
create table okr_session_risks (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique,
  session_id       uuid not null references okr_sessions(id) on delete restrict,      -- the session where it was recorded
  kind             text not null default 'RISK' check (kind in ('RISK','BLOCKER','ISSUE')),
  title            text not null check (btrim(title) <> '' and char_length(title) <= 300),
  description      text not null check (btrim(description) <> '' and char_length(description) <= 10000),
  business_unit_id uuid not null references business_units(id),
  category         text not null default 'OPERATIONAL' check (category in ('OPERATIONAL','FINANCIAL','PEOPLE','TECHNICAL','COMPLIANCE','EXTERNAL','OTHER')),
  severity         text not null default 'MEDIUM' check (severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  business_impact  text check (business_impact is null or char_length(business_impact) <= 5000),
  root_cause       text check (root_cause is null or char_length(root_cause) <= 5000),
  mitigation       text check (mitigation is null or char_length(mitigation) <= 5000),
  owner_id         uuid references users(id),
  target_date      date,
  status           text not null default 'OPEN' check (status in ('OPEN','MITIGATING','RESOLVED','CLOSED')),
  resolution_note  text check (resolution_note is null or char_length(resolution_note) <= 5000),
  resolved_at      timestamptz,
  source_note_id   uuid references okr_session_notes(id),
  fingerprint      text generated always as (lower(regexp_replace(btrim(title), '\s+', ' ', 'g'))) stored,   -- the same issue raised again in another session is recognised as repeated
  client_key       text check (client_key is null or char_length(client_key) between 8 and 100),
  version          int not null default 1,
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default app_now(),
  updated_at       timestamptz not null default app_now(),
  check ((status in ('RESOLVED','CLOSED')) = (resolved_at is not null))
);
create index okr_session_risks_session_idx on okr_session_risks (session_id);
create index okr_session_risks_bu_status_idx on okr_session_risks (business_unit_id, status);
create index okr_session_risks_fingerprint_idx on okr_session_risks (business_unit_id, fingerprint);
create unique index okr_session_risks_client_key_idx on okr_session_risks (created_by, client_key) where client_key is not null;
create index okr_session_risks_fts_idx on okr_session_risks using gin (to_tsvector('simple', title || ' ' || description));

-- ------------------------------------------------------------------ open items reviewed in a later session (the same row, never a copy)
create table okr_session_carryovers (
  session_id  uuid not null references okr_sessions(id) on delete restrict,
  item_type   text not null check (item_type in ('ACTION','RISK')),
  item_id     uuid not null,
  outcome     text not null check (outcome in ('STILL_OPEN','UPDATE_REQUESTED','EXPLAINED','COMPLETION_CONFIRMED','EXTENDED','ESCALATED','RESOLVED')),
  remarks     text check (remarks is null or char_length(remarks) <= 3000),
  reviewed_by uuid not null references users(id),
  reviewed_at timestamptz not null default app_now(),
  primary key (session_id, item_type, item_id)
);
create index okr_session_carryovers_item_idx on okr_session_carryovers (item_type, item_id);

-- ------------------------------------------------------------------ row-level security
alter table okr_session_decisions enable row level security;
alter table okr_session_actions   enable row level security;
alter table okr_session_risks     enable row level security;
alter table okr_session_carryovers enable row level security;
grant select on okr_session_decisions, okr_session_actions, okr_session_risks, okr_session_carryovers to authenticated;

create policy read_visible on okr_session_decisions for select to authenticated using ((select auth_okr_session_visible(session_id)));
create policy read_visible on okr_session_risks for select to authenticated using ((select auth_okr_session_visible(session_id)));
create policy read_visible on okr_session_carryovers for select to authenticated using ((select auth_okr_session_visible(session_id)));
-- an action is also visible to the person it is assigned to and the person who set it, whatever their access to the session
create policy read_visible on okr_session_actions for select to authenticated using (
  assignee_id = (select auth.uid()) or created_by = (select auth.uid()) or (select auth_okr_session_visible(origin_session_id)));

-- ------------------------------------------------------------------ helpers
create or replace function okr_notify(p_actor uuid, p_users uuid[], p_event text, p_type text, p_id uuid, p_title text, p_message text, p_dedupe text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ids uuid[];
begin
  select coalesce(array_agg(distinct u.id), '{}') into v_ids from users u where u.id = any(p_users) and u.status = 'ACTIVE' and u.id is distinct from p_actor;
  if cardinality(v_ids) > 0 then perform notify_users(v_ids, p_event, p_type, p_id::text, left(p_title, 200), left(p_message, 1000), p_dedupe); end if;
end $$;

create or replace function okr_session_audience(p_session uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select facilitator_id x from okr_sessions where id = p_session
    union select user_id from okr_session_participants where session_id = p_session and removed_at is null) q;
$$;

create or replace function okr_user_ok(p_user uuid, p_what text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from users u join employees e on e.id = u.employee_id where u.id = p_user and u.status = 'ACTIVE' and e.employment_status = 'ACTIVE') then
    raise exception 'ASSIGNEE_UNAVAILABLE' using detail = p_what || ' is suspended or no longer with the organisation';
  end if;
end $$;

-- ------------------------------------------------------------------ decisions
create or replace function create_okr_decision(
  p_actor uuid, p_session uuid, p_title text, p_description text, p_background text, p_justification text, p_date date, p_affected_bu uuid,
  p_involved uuid[], p_expected_outcome text, p_follow_up text, p_source_note uuid, p_authority_note text, p_links jsonb, p_client_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s okr_sessions; v_id uuid; v_ref text; v_old uuid; x jsonb;
begin
  perform require_permission(p_actor, 'session_decisions.create');
  if p_client_key is not null then select id into v_old from okr_session_decisions where created_by = p_actor and client_key = p_client_key; if found then return jsonb_build_object('id', v_old, 'replayed', true); end if; end if;
  s := okr_get_session(p_actor, p_session);
  perform okr_assert_open(s);
  perform assert_unit_scope(p_actor, s.business_unit_id);
  if p_affected_bu is not null and (not exists (select 1 from business_units where id = p_affected_bu) or (s.business_unit_id is not null and p_affected_bu <> s.business_unit_id)) then
    raise exception 'VALIDATION_ERROR' using detail = 'the affected business unit must be the session''s unit'; end if;
  if p_source_note is not null and not exists (select 1 from okr_session_notes where id = p_source_note and session_id = s.id) then raise exception 'NOT_FOUND' using detail = 'source note'; end if;
  v_ref := okr_next_ref('DECISION', 'DEC', extract(year from coalesce(p_date, okr_today_wat()))::int);
  insert into okr_session_decisions (reference, session_id, title, description, background, justification, decision_date, involved_user_ids, affected_bu_id, expected_outcome, follow_up,
                                     source_note_id, authority_note, client_key, created_by)
  values (v_ref, s.id, okr_clean(p_title, 300, 'a title', true), okr_clean(p_description, 10000, 'the description', true), okr_clean(p_background, 10000, 'the background'),
          okr_clean(p_justification, 10000, 'the justification'), coalesce(p_date, okr_today_wat()), coalesce(p_involved, '{}'), coalesce(p_affected_bu, s.business_unit_id),
          okr_clean(p_expected_outcome, 5000, 'the expected outcome'), okr_clean(p_follow_up, 5000, 'the follow-up'), p_source_note, okr_clean(p_authority_note, 300, 'the authority'), p_client_key, p_actor)
  returning id into v_id;
  for x in select * from jsonb_array_elements(okr_arr(p_links)) loop
    perform okr_add_link(p_actor, s, 'DECISION', v_id, x ->> 'target_type', (x ->> 'target_id')::uuid);
  end loop;
  perform okr_log(p_actor, s.id, 'DECISION', v_id, 'CREATED', jsonb_build_object('reference', v_ref, 'status', 'PROPOSED', 'title', okr_clean(p_title, 300, 'a title', true)));
  perform okr_notify(p_actor, okr_session_audience(s.id), 'SESSION_DECISION', 'okr_decision', v_id, 'Decision proposed: ' || left(p_title, 120), 'A decision was proposed in session ' || s.reference || '. It is not formal until approved.', 'okrdec:' || v_id || ':PROPOSED');
  return jsonb_build_object('id', v_id, 'reference', v_ref, 'version', 1, 'replayed', false);
exception when unique_violation then
  select id into v_old from okr_session_decisions where created_by = p_actor and client_key = p_client_key;
  if v_old is null then raise; end if;
  return jsonb_build_object('id', v_old, 'replayed', true);
end $$;

-- the Lagos calendar date (the business day) at the application clock
create or replace function okr_today_wat() returns date
language sql stable as $$ select (app_now() at time zone 'Africa/Lagos')::date $$;

-- amend a PROPOSED decision (an approved one is superseded, not edited)
create or replace function update_okr_decision(
  p_actor uuid, p_decision uuid, p_expected_version int, p_title text, p_description text, p_background text, p_justification text, p_date date,
  p_involved uuid[], p_expected_outcome text, p_follow_up text, p_authority_note text, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare d okr_session_decisions; s okr_sessions; v_reason text := okr_clean(p_reason, 2000, 'the reason', true);
begin
  perform require_permission(p_actor, 'session_decisions.create');
  select * into d from okr_session_decisions where id = p_decision for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  s := okr_get_session(p_actor, d.session_id);
  perform okr_assert_open(s);
  if d.status <> 'PROPOSED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'only a proposed decision can be amended; supersede an approved one'; end if;
  perform okr_check_version(p_expected_version, d.version);
  perform okr_log(p_actor, s.id, 'DECISION', d.id, 'AMENDED', jsonb_build_object('before', to_jsonb(d) - 'client_key'), v_reason);
  update okr_session_decisions set title = coalesce(okr_clean(p_title, 300, 'a title'), title), description = coalesce(okr_clean(p_description, 10000, 'the description'), description),
         background = okr_clean(p_background, 10000, 'the background'), justification = okr_clean(p_justification, 10000, 'the justification'), decision_date = coalesce(p_date, decision_date),
         involved_user_ids = coalesce(p_involved, involved_user_ids), expected_outcome = okr_clean(p_expected_outcome, 5000, 'the expected outcome'), follow_up = okr_clean(p_follow_up, 5000, 'the follow-up'),
         authority_note = okr_clean(p_authority_note, 300, 'the authority'), version = version + 1, updated_at = app_now()
   where id = d.id;
  return jsonb_build_object('id', d.id, 'version', d.version + 1);
end $$;

-- APPROVE / REJECT need session_decisions.approve (PROPOSED only). WITHDRAW: the person who recorded it or an approver (PROPOSED or APPROVED).
create or replace function decide_okr_decision(p_actor uuid, p_decision uuid, p_outcome text, p_reason text, p_authority_note text, p_expected_version int, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare d okr_session_decisions; s okr_sessions; v_prev jsonb; v_reason text := okr_clean(p_reason, 2000, 'the reason'); v_to text; v_res jsonb;
begin
  v_prev := okr_idem(p_actor, p_key, 'decide_okr_decision'); if v_prev is not null then return v_prev; end if;
  select * into d from okr_session_decisions where id = p_decision for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  s := okr_get_session(p_actor, d.session_id);
  perform okr_assert_open(s);
  perform okr_check_version(p_expected_version, d.version);
  v_to := case p_outcome when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' when 'WITHDRAW' then 'WITHDRAWN' else null end;
  if v_to is null then raise exception 'VALIDATION_ERROR' using detail = 'choose approve, reject or withdraw'; end if;
  if v_to in ('APPROVED','REJECTED') then
    perform require_permission(p_actor, 'session_decisions.approve');
    if d.status <> 'PROPOSED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'only a proposed decision can be approved or rejected'; end if;
    if v_to = 'REJECTED' and v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  else
    if not (d.created_by = p_actor and actor_has_permission(p_actor, 'session_decisions.create')) then perform require_permission(p_actor, 'session_decisions.approve'); end if;
    if d.status not in ('PROPOSED','APPROVED') then raise exception 'INVALID_STATE_TRANSITION'; end if;
    if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  end if;
  update okr_session_decisions set status = v_to, version = version + 1, updated_at = app_now(), status_reason = v_reason,
         decided_by = case when v_to in ('APPROVED','REJECTED') then p_actor else decided_by end,
         decided_at = case when v_to in ('APPROVED','REJECTED') then app_now() else decided_at end,
         authority_note = coalesce(okr_clean(p_authority_note, 300, 'the authority'), authority_note)
   where id = d.id;
  perform okr_log(p_actor, s.id, 'DECISION', d.id, v_to, jsonb_build_object('from', d.status, 'title', d.title), v_reason);
  perform okr_notify(p_actor, okr_session_audience(s.id) || d.created_by, 'SESSION_DECISION', 'okr_decision', d.id, 'Decision ' || lower(v_to) || ': ' || left(d.title, 120),
                     'The decision "' || left(d.title, 120) || '" in session ' || s.reference || ' is now ' || lower(v_to) || '.', 'okrdec:' || d.id || ':' || v_to);
  v_res := jsonb_build_object('id', d.id, 'status', v_to, 'version', d.version + 1, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

-- replaces an APPROVED decision by a new APPROVED one (the correction path); the old one is kept and marked SUPERSEDED
create or replace function supersede_okr_decision(
  p_actor uuid, p_old uuid, p_title text, p_description text, p_background text, p_justification text, p_expected_outcome text, p_follow_up text, p_reason text, p_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o okr_session_decisions; s okr_sessions; v_prev jsonb; v_id uuid := gen_random_uuid(); v_ref text; v_reason text := okr_clean(p_reason, 2000, 'the reason', true); v_res jsonb;
begin
  perform require_permission(p_actor, 'session_decisions.approve');
  v_prev := okr_idem(p_actor, p_key, 'supersede_okr_decision'); if v_prev is not null then return v_prev; end if;
  select * into o from okr_session_decisions where id = p_old for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  s := okr_get_session(p_actor, o.session_id);
  perform okr_assert_open(s);
  if o.status <> 'APPROVED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'only an approved decision can be superseded'; end if;
  v_ref := okr_next_ref('DECISION', 'DEC', extract(year from okr_today_wat())::int);
  insert into okr_session_decisions (id, reference, session_id, title, description, background, justification, decision_date, status, decided_by, decided_at, involved_user_ids, affected_bu_id,
                                     expected_outcome, follow_up, source_note_id, supersedes_id, status_reason, created_by)
  values (v_id, v_ref, o.session_id, coalesce(okr_clean(p_title, 300, 'a title'), o.title), coalesce(okr_clean(p_description, 10000, 'the description'), o.description),
          coalesce(okr_clean(p_background, 10000, 'the background'), o.background), coalesce(okr_clean(p_justification, 10000, 'the justification'), o.justification), okr_today_wat(), 'APPROVED', p_actor, app_now(),
          o.involved_user_ids, o.affected_bu_id, coalesce(okr_clean(p_expected_outcome, 5000, 'the expected outcome'), o.expected_outcome), coalesce(okr_clean(p_follow_up, 5000, 'the follow-up'), o.follow_up),
          o.source_note_id, o.id, v_reason, p_actor);
  update okr_session_decisions set status = 'SUPERSEDED', superseded_by_id = v_id, status_reason = v_reason, version = version + 1, updated_at = app_now() where id = o.id;
  perform okr_log(p_actor, s.id, 'DECISION', o.id, 'SUPERSEDED', jsonb_build_object('superseded_by', v_id, 'reference', o.reference, 'before', to_jsonb(o) - 'client_key'), v_reason);
  perform okr_log(p_actor, s.id, 'DECISION', v_id, 'APPROVED', jsonb_build_object('supersedes', o.id, 'reference', v_ref));
  perform okr_notify(p_actor, okr_session_audience(s.id) || o.created_by, 'SESSION_DECISION', 'okr_decision', v_id, 'Decision amended: ' || left(o.title, 120),
                     'The decision ' || o.reference || ' was replaced by ' || v_ref || ' in session ' || s.reference || '.', 'okrdec:' || v_id || ':SUPERSEDES');
  v_res := jsonb_build_object('id', v_id, 'reference', v_ref, 'superseded_id', o.id, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

-- ------------------------------------------------------------------ action items
create or replace function create_okr_action(
  p_actor uuid, p_session uuid, p_description text, p_assignee uuid, p_bu uuid, p_priority text, p_due date, p_source_note uuid, p_source_decision uuid,
  p_requires_verification boolean, p_evidence_required boolean, p_links jsonb, p_client_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s okr_sessions; v_id uuid; v_ref text; v_old uuid; v_bu uuid; x jsonb;
begin
  perform require_permission(p_actor, 'session_actions.create');
  if p_client_key is not null then select id into v_old from okr_session_actions where created_by = p_actor and client_key = p_client_key; if found then return jsonb_build_object('id', v_old, 'replayed', true); end if; end if;
  s := okr_get_session(p_actor, p_session);
  perform okr_assert_open(s);
  v_bu := coalesce(p_bu, s.business_unit_id);
  if v_bu is null then raise exception 'VALIDATION_ERROR' using detail = 'choose the business unit responsible for the action'; end if;
  if s.business_unit_id is not null and v_bu <> s.business_unit_id then raise exception 'VALIDATION_ERROR' using detail = 'the responsible unit must be the session''s unit'; end if;
  perform assert_unit_scope(p_actor, v_bu);
  if p_due is null or p_due < okr_today_wat() then raise exception 'VALIDATION_ERROR' using detail = 'the due date cannot be in the past'; end if;
  if p_assignee is null then raise exception 'VALIDATION_ERROR' using detail = 'choose who is responsible'; end if;
  perform okr_user_ok(p_assignee, 'the person chosen');
  if p_source_note is not null and not exists (select 1 from okr_session_notes where id = p_source_note and session_id = s.id) then raise exception 'NOT_FOUND' using detail = 'source note'; end if;
  if p_source_decision is not null and not exists (select 1 from okr_session_decisions where id = p_source_decision and session_id = s.id) then raise exception 'NOT_FOUND' using detail = 'source decision'; end if;
  v_ref := okr_next_ref('ACTION', 'ACT', extract(year from okr_today_wat())::int);
  insert into okr_session_actions (reference, origin_session_id, source_note_id, source_decision_id, description, business_unit_id, assignee_id, priority, due_date, original_due_date,
                                   requires_verification, evidence_required, verification_status, client_key, created_by)
  values (v_ref, s.id, p_source_note, p_source_decision, okr_clean(p_description, 5000, 'the description', true), v_bu, p_assignee, coalesce(p_priority, 'MEDIUM'), p_due, p_due,
          coalesce(p_requires_verification, false), coalesce(p_evidence_required, false), 'NOT_REQUIRED', p_client_key, p_actor)
  returning id into v_id;
  for x in select * from jsonb_array_elements(okr_arr(p_links)) loop
    perform okr_add_link(p_actor, s, 'ACTION', v_id, x ->> 'target_type', (x ->> 'target_id')::uuid);
  end loop;
  perform okr_log(p_actor, s.id, 'ACTION', v_id, 'CREATED', jsonb_build_object('reference', v_ref, 'assignee_id', p_assignee, 'due_date', p_due, 'priority', coalesce(p_priority, 'MEDIUM')));
  perform okr_notify(p_actor, array[p_assignee], 'SESSION_ACTION_ASSIGNED', 'okr_action', v_id, 'Action assigned to you: ' || v_ref,
                     left(p_description, 300) || ' (due ' || to_char(p_due, 'DD Mon YYYY') || ', session ' || s.reference || ')', 'okract:' || v_id || ':assigned:' || p_assignee);
  return jsonb_build_object('id', v_id, 'reference', v_ref, 'version', 1, 'replayed', false);
exception when unique_violation then
  select id into v_old from okr_session_actions where created_by = p_actor and client_key = p_client_key;
  if v_old is null then raise; end if;
  return jsonb_build_object('id', v_old, 'replayed', true);
end $$;

-- who may report on an action: the assignee, whoever set it, an assigner, and (with session_actions.update) the BU lead of the responsible unit
create or replace function okr_can_work_action(p_actor uuid, a okr_session_actions) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select a.assignee_id = p_actor or a.created_by = p_actor or actor_has_permission(p_actor, 'session_actions.assign')
      or (actor_has_permission(p_actor, 'session_actions.update') and a.business_unit_id = actor_bu(p_actor));
$$;

-- progress / status. p_status null keeps the status. Completion needs remarks (and evidence where the action requires it).
create or replace function update_okr_action(
  p_actor uuid, p_action uuid, p_expected_version int, p_status text, p_progress text, p_blocked_reason text, p_completion_remarks text, p_context_session uuid, p_reason text, p_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a okr_session_actions; s okr_sessions; v_prev jsonb; v_to text; v_progress text := okr_clean(p_progress, 5000, 'the progress update'); v_res jsonb; v_remarks text; v_reason text := okr_clean(p_reason, 2000, 'the reason');
  v_ctx uuid;
begin
  v_prev := okr_idem(p_actor, p_key, 'update_okr_action'); if v_prev is not null then return v_prev; end if;
  select * into a from okr_session_actions where id = p_action for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (a.assignee_id = p_actor or a.created_by = p_actor or okr_session_visible_to(p_actor, a.origin_session_id)) then raise exception 'BU_SCOPE_DENIED'; end if;
  if not okr_can_work_action(p_actor, a) then raise exception 'PERMISSION_DENIED' using detail = 'only the assignee, the person who set it, or an assigner can update this action'; end if;
  select * into s from okr_sessions where id = a.origin_session_id;
  v_ctx := coalesce(p_context_session, a.origin_session_id);
  perform okr_check_version(p_expected_version, a.version);
  v_to := coalesce(p_status, a.status);
  if v_to <> a.status then
    if (a.status, v_to) not in (('OPEN','IN_PROGRESS'),('OPEN','BLOCKED'),('OPEN','COMPLETED'),('OPEN','CANCELLED'),('IN_PROGRESS','OPEN'),('IN_PROGRESS','BLOCKED'),('IN_PROGRESS','COMPLETED'),
        ('IN_PROGRESS','CANCELLED'),('BLOCKED','IN_PROGRESS'),('BLOCKED','OPEN'),('BLOCKED','COMPLETED'),('BLOCKED','CANCELLED'),('COMPLETED','IN_PROGRESS'),('CANCELLED','OPEN')) then
      raise exception 'INVALID_STATE_TRANSITION' using detail = a.status || ' to ' || v_to;
    end if;
    if v_to = 'CANCELLED' and not (a.created_by = p_actor or actor_has_permission(p_actor, 'session_actions.assign')) then raise exception 'PERMISSION_DENIED' using detail = 'only the person who set the action or an assigner can cancel it'; end if;
    if a.status in ('COMPLETED','CANCELLED') and not actor_has_permission(p_actor, 'session_actions.assign') then raise exception 'PERMISSION_DENIED' using detail = 'only an assigner can reopen an action'; end if;
    if a.status in ('COMPLETED','CANCELLED') and v_reason is null then raise exception 'REASON_REQUIRED' using detail = 'say why the action is being reopened'; end if;
    if v_to = 'CANCELLED' and v_reason is null then raise exception 'REASON_REQUIRED' using detail = 'say why the action is being cancelled'; end if;
  end if;
  if v_to = 'BLOCKED' and okr_clean(coalesce(p_blocked_reason, a.blocked_reason), 2000, 'the reason it is blocked') is null then raise exception 'REASON_REQUIRED' using detail = 'say what is blocking the action'; end if;
  if v_to = 'COMPLETED' and a.status <> 'COMPLETED' then
    v_remarks := okr_clean(p_completion_remarks, 5000, 'the completion remarks');
    if v_remarks is null then raise exception 'REASON_REQUIRED' using detail = 'say what was done to complete the action'; end if;
    if a.evidence_required and not exists (select 1 from okr_session_attachments t where t.record_type = 'ACTION' and t.record_id = a.id and t.purpose = 'COMPLETION_EVIDENCE' and t.deleted_at is null) then
      raise exception 'EVIDENCE_REQUIRED' using detail = 'attach the evidence of completion first'; end if;
  end if;
  update okr_session_actions set status = v_to, version = version + 1, updated_at = app_now(),
         progress_note = coalesce(v_progress, progress_note),
         blocked_reason = case when v_to = 'BLOCKED' then coalesce(okr_clean(p_blocked_reason, 2000, 'the reason it is blocked'), blocked_reason) else null end,
         completed_at = case when v_to = 'COMPLETED' and a.status <> 'COMPLETED' then app_now() when v_to <> 'COMPLETED' then null else completed_at end,
         completed_by = case when v_to = 'COMPLETED' and a.status <> 'COMPLETED' then p_actor when v_to <> 'COMPLETED' then null else completed_by end,
         completion_remarks = case when v_to = 'COMPLETED' and a.status <> 'COMPLETED' then v_remarks when v_to <> 'COMPLETED' then null else completion_remarks end,
         verification_status = case when v_to = 'COMPLETED' and a.status <> 'COMPLETED' and requires_verification then 'PENDING'
                                    when v_to <> 'COMPLETED' and verification_status = 'PENDING' then 'NOT_REQUIRED' else verification_status end
   where id = a.id;
  perform okr_log(p_actor, v_ctx, 'ACTION', a.id, case when v_to <> a.status then 'STATUS_' || v_to else 'PROGRESS' end,
                  jsonb_build_object('from', a.status, 'to', v_to, 'progress', v_progress, 'reference', a.reference, 'blocked_reason', p_blocked_reason, 'origin_session_id', a.origin_session_id), coalesce(v_remarks, v_reason));
  if v_to = 'BLOCKED' and a.status <> 'BLOCKED' then
    perform okr_notify(p_actor, array[a.created_by, s.facilitator_id], 'SESSION_ACTION_BLOCKED', 'okr_action', a.id, 'Action blocked: ' || a.reference, left(a.description, 200) || ' — ' || left(coalesce(p_blocked_reason, a.blocked_reason, ''), 300), 'okract:' || a.id || ':blocked:' || (a.version + 1));
  elsif v_to = 'COMPLETED' and a.status <> 'COMPLETED' then
    perform okr_notify(p_actor, array[a.created_by, s.facilitator_id], 'SESSION_ACTION_COMPLETED', 'okr_action', a.id, 'Action completed: ' || a.reference,
                       left(a.description, 200) || case when a.requires_verification then ' — awaiting verification.' else '' end, 'okract:' || a.id || ':completed:' || (a.version + 1));
  end if;
  v_res := jsonb_build_object('id', a.id, 'status', v_to, 'version', a.version + 1, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

create or replace function reassign_okr_action(p_actor uuid, p_action uuid, p_new_assignee uuid, p_reason text, p_expected_version int, p_context_session uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a okr_session_actions; v_reason text := okr_clean(p_reason, 2000, 'the reason', true);
begin
  perform require_permission(p_actor, 'session_actions.assign');
  select * into a from okr_session_actions where id = p_action for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not okr_session_visible_to(p_actor, a.origin_session_id) then raise exception 'BU_SCOPE_DENIED'; end if;
  perform assert_unit_scope(p_actor, a.business_unit_id);
  perform okr_check_version(p_expected_version, a.version);
  if a.status in ('COMPLETED','CANCELLED') then raise exception 'INVALID_STATE_TRANSITION' using detail = 'a finished action cannot be reassigned'; end if;
  if p_new_assignee is null or p_new_assignee = a.assignee_id then raise exception 'VALIDATION_ERROR' using detail = 'choose a different person'; end if;
  perform okr_user_ok(p_new_assignee, 'the person chosen');
  update okr_session_actions set assignee_id = p_new_assignee, version = version + 1, updated_at = app_now() where id = a.id;
  perform okr_log(p_actor, coalesce(p_context_session, a.origin_session_id), 'ACTION', a.id, 'REASSIGNED',
                  jsonb_build_object('from', a.assignee_id, 'to', p_new_assignee, 'reference', a.reference, 'origin_session_id', a.origin_session_id), v_reason);
  perform okr_notify(p_actor, array[p_new_assignee], 'SESSION_ACTION_ASSIGNED', 'okr_action', a.id, 'Action assigned to you: ' || a.reference, left(a.description, 300) || ' (due ' || to_char(a.due_date, 'DD Mon YYYY') || ')', 'okract:' || a.id || ':assigned:' || p_new_assignee);
  perform okr_notify(p_actor, array[a.assignee_id], 'SESSION_ACTION_REASSIGNED', 'okr_action', a.id, 'Action reassigned: ' || a.reference, left(a.description, 200) || ' was reassigned. Reason: ' || left(v_reason, 300), 'okract:' || a.id || ':reassigned:' || (a.version + 1));
  return jsonb_build_object('id', a.id, 'version', a.version + 1);
end $$;

create or replace function extend_okr_action(p_actor uuid, p_action uuid, p_new_due date, p_reason text, p_expected_version int, p_context_session uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a okr_session_actions; v_reason text := okr_clean(p_reason, 2000, 'the justification', true);
begin
  perform require_permission(p_actor, 'session_actions.assign');
  select * into a from okr_session_actions where id = p_action for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not okr_session_visible_to(p_actor, a.origin_session_id) then raise exception 'BU_SCOPE_DENIED'; end if;
  perform assert_unit_scope(p_actor, a.business_unit_id);
  perform okr_check_version(p_expected_version, a.version);
  if a.status in ('COMPLETED','CANCELLED') then raise exception 'INVALID_STATE_TRANSITION'; end if;
  if p_new_due is null or p_new_due <= a.due_date then raise exception 'VALIDATION_ERROR' using detail = 'the new due date must be later than the current one'; end if;
  update okr_session_actions set due_date = p_new_due, extensions = extensions + 1, version = version + 1, updated_at = app_now() where id = a.id;
  perform okr_log(p_actor, coalesce(p_context_session, a.origin_session_id), 'ACTION', a.id, 'DUE_EXTENDED',
                  jsonb_build_object('from', a.due_date, 'to', p_new_due, 'reference', a.reference, 'origin_session_id', a.origin_session_id), v_reason);
  perform okr_notify(p_actor, array[a.assignee_id, a.created_by], 'SESSION_ACTION_FOLLOW_UP', 'okr_action', a.id, 'Deadline extended: ' || a.reference, 'The due date moved to ' || to_char(p_new_due, 'DD Mon YYYY') || '. ' || left(v_reason, 300), 'okract:' || a.id || ':extended:' || (a.version + 1));
  return jsonb_build_object('id', a.id, 'version', a.version + 1, 'due_date', p_new_due);
end $$;

create or replace function escalate_okr_action(p_actor uuid, p_action uuid, p_reason text, p_context_session uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a okr_session_actions; s okr_sessions; v_reason text := okr_clean(p_reason, 2000, 'the reason', true);
begin
  perform require_permission(p_actor, 'session_actions.assign');
  select * into a from okr_session_actions where id = p_action for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not okr_session_visible_to(p_actor, a.origin_session_id) then raise exception 'BU_SCOPE_DENIED'; end if;
  if a.status in ('COMPLETED','CANCELLED') then raise exception 'INVALID_STATE_TRANSITION'; end if;
  if a.escalated_at is not null then raise exception 'INVALID_STATE_TRANSITION' using detail = 'this action is already escalated'; end if;
  select * into s from okr_sessions where id = a.origin_session_id;
  update okr_session_actions set escalated_at = app_now(), escalated_by = p_actor, escalation_reason = v_reason, version = version + 1, updated_at = app_now() where id = a.id;
  perform okr_log(p_actor, coalesce(p_context_session, a.origin_session_id), 'ACTION', a.id, 'ESCALATED', jsonb_build_object('reference', a.reference, 'origin_session_id', a.origin_session_id), v_reason);
  perform okr_notify(p_actor, users_with_role('EXECUTIVE') || users_with_role('DIRECTOR') || array[s.facilitator_id, a.assignee_id], 'SESSION_ACTION_FOLLOW_UP', 'okr_action', a.id,
                     'Action escalated: ' || a.reference, left(a.description, 200) || ' — ' || left(v_reason, 300), 'okract:' || a.id || ':escalated');
  return jsonb_build_object('id', a.id, 'version', a.version + 1);
end $$;

-- the completion of an action is checked by someone other than the person who completed it
create or replace function verify_okr_action(p_actor uuid, p_action uuid, p_outcome text, p_remarks text, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a okr_session_actions; v_remarks text := okr_clean(p_remarks, 3000, 'the remarks');
begin
  perform require_permission(p_actor, 'session_actions.verify');
  select * into a from okr_session_actions where id = p_action for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not okr_session_visible_to(p_actor, a.origin_session_id) then raise exception 'BU_SCOPE_DENIED'; end if;
  perform okr_check_version(p_expected_version, a.version);
  if a.status <> 'COMPLETED' or a.verification_status <> 'PENDING' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'there is no completion waiting to be verified'; end if;
  if a.completed_by = p_actor then raise exception 'SESSION_ACTION_SELF_VERIFICATION'; end if;
  if p_outcome not in ('VERIFIED','REJECTED') then raise exception 'VALIDATION_ERROR' using detail = 'choose verified or rejected'; end if;
  if p_outcome = 'REJECTED' and v_remarks is null then raise exception 'REASON_REQUIRED' using detail = 'say what is missing'; end if;
  update okr_session_actions set verification_status = p_outcome, verified_by = p_actor, verified_at = app_now(), version = version + 1, updated_at = app_now(),
         status = case when p_outcome = 'REJECTED' then 'IN_PROGRESS' else status end,
         completed_at = case when p_outcome = 'REJECTED' then null else completed_at end,
         completed_by = case when p_outcome = 'REJECTED' then null else completed_by end,
         completion_remarks = case when p_outcome = 'REJECTED' then null else completion_remarks end
   where id = a.id;
  perform okr_log(p_actor, a.origin_session_id, 'ACTION', a.id, 'VERIFICATION_' || p_outcome, jsonb_build_object('reference', a.reference, 'completed_by', a.completed_by), v_remarks);
  perform okr_notify(p_actor, array[a.assignee_id, a.completed_by, a.created_by], 'SESSION_ACTION_VERIFIED', 'okr_action', a.id, 'Completion ' || lower(p_outcome) || ': ' || a.reference,
                     left(a.description, 200) || coalesce(' — ' || left(v_remarks, 300), ''), 'okract:' || a.id || ':verification:' || (a.version + 1));
  return jsonb_build_object('id', a.id, 'version', a.version + 1, 'verification_status', p_outcome);
end $$;

-- ------------------------------------------------------------------ risks, blockers and issues
create or replace function create_okr_risk(
  p_actor uuid, p_session uuid, p_kind text, p_title text, p_description text, p_bu uuid, p_category text, p_severity text, p_impact text, p_root_cause text,
  p_mitigation text, p_owner uuid, p_target date, p_source_note uuid, p_links jsonb, p_client_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s okr_sessions; v_id uuid; v_ref text; v_old uuid; v_bu uuid; x jsonb;
begin
  perform require_permission(p_actor, 'session_risks.manage');
  if p_client_key is not null then select id into v_old from okr_session_risks where created_by = p_actor and client_key = p_client_key; if found then return jsonb_build_object('id', v_old, 'replayed', true); end if; end if;
  s := okr_get_session(p_actor, p_session);
  perform okr_assert_open(s);
  v_bu := coalesce(p_bu, s.business_unit_id);
  if v_bu is null then raise exception 'VALIDATION_ERROR' using detail = 'choose the business unit affected'; end if;
  if s.business_unit_id is not null and v_bu <> s.business_unit_id then raise exception 'VALIDATION_ERROR' using detail = 'the affected unit must be the session''s unit'; end if;
  perform assert_unit_scope(p_actor, v_bu);
  if p_owner is not null then perform okr_user_ok(p_owner, 'the person chosen'); end if;
  if p_source_note is not null and not exists (select 1 from okr_session_notes where id = p_source_note and session_id = s.id) then raise exception 'NOT_FOUND' using detail = 'source note'; end if;
  v_ref := okr_next_ref('RISK', 'RSK', extract(year from okr_today_wat())::int);
  insert into okr_session_risks (reference, session_id, kind, title, description, business_unit_id, category, severity, business_impact, root_cause, mitigation, owner_id, target_date, source_note_id, client_key, created_by)
  values (v_ref, s.id, coalesce(p_kind, 'RISK'), okr_clean(p_title, 300, 'a title', true), okr_clean(p_description, 10000, 'the description', true), v_bu, coalesce(p_category, 'OPERATIONAL'), coalesce(p_severity, 'MEDIUM'),
          okr_clean(p_impact, 5000, 'the business impact'), okr_clean(p_root_cause, 5000, 'the root cause'), okr_clean(p_mitigation, 5000, 'the mitigation'), p_owner, p_target, p_source_note, p_client_key, p_actor)
  returning id into v_id;
  for x in select * from jsonb_array_elements(okr_arr(p_links)) loop
    perform okr_add_link(p_actor, s, 'RISK', v_id, x ->> 'target_type', (x ->> 'target_id')::uuid);
  end loop;
  perform okr_log(p_actor, s.id, 'RISK', v_id, 'CREATED', jsonb_build_object('reference', v_ref, 'kind', coalesce(p_kind, 'RISK'), 'severity', coalesce(p_severity, 'MEDIUM')));
  return jsonb_build_object('id', v_id, 'reference', v_ref, 'version', 1, 'replayed', false);
exception when unique_violation then
  select id into v_old from okr_session_risks where created_by = p_actor and client_key = p_client_key;
  if v_old is null then raise; end if;
  return jsonb_build_object('id', v_old, 'replayed', true);
end $$;

create or replace function update_okr_risk(
  p_actor uuid, p_risk uuid, p_expected_version int, p_status text, p_severity text, p_description text, p_impact text, p_root_cause text, p_mitigation text,
  p_owner uuid, p_target date, p_resolution_note text, p_context_session uuid, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r okr_session_risks; v_to text; v_note text := okr_clean(p_resolution_note, 5000, 'the resolution note'); v_reason text := okr_clean(p_reason, 2000, 'the reason'); s okr_sessions;
begin
  perform require_permission(p_actor, 'session_risks.manage');
  select * into r from okr_session_risks where id = p_risk for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  s := okr_get_session(p_actor, r.session_id);
  perform assert_unit_scope(p_actor, r.business_unit_id);
  perform okr_check_version(p_expected_version, r.version);
  v_to := coalesce(p_status, r.status);
  if v_to <> r.status and (r.status, v_to) not in (('OPEN','MITIGATING'),('OPEN','RESOLVED'),('OPEN','CLOSED'),('MITIGATING','OPEN'),('MITIGATING','RESOLVED'),('MITIGATING','CLOSED'),('RESOLVED','CLOSED'),('RESOLVED','OPEN'),('CLOSED','OPEN')) then
    raise exception 'INVALID_STATE_TRANSITION' using detail = r.status || ' to ' || v_to;
  end if;
  if v_to in ('RESOLVED','CLOSED') and r.status not in ('RESOLVED','CLOSED') and v_note is null then raise exception 'REASON_REQUIRED' using detail = 'say how it was resolved'; end if;
  if r.status in ('RESOLVED','CLOSED') and v_to = 'OPEN' and v_reason is null then raise exception 'REASON_REQUIRED' using detail = 'say why it is being reopened'; end if;
  if p_owner is not null and p_owner is distinct from r.owner_id then perform okr_user_ok(p_owner, 'the person chosen'); end if;
  perform okr_log(p_actor, coalesce(p_context_session, r.session_id), 'RISK', r.id, case when v_to <> r.status then 'STATUS_' || v_to else 'UPDATED' end,
                  jsonb_build_object('before', to_jsonb(r) - 'client_key' - 'fingerprint', 'origin_session_id', r.session_id), coalesce(v_note, v_reason));
  update okr_session_risks set status = v_to, severity = coalesce(p_severity, severity), description = coalesce(okr_clean(p_description, 10000, 'the description'), description),
         business_impact = case when p_impact is null then business_impact else okr_clean(p_impact, 5000, 'the business impact') end,
         root_cause = case when p_root_cause is null then root_cause else okr_clean(p_root_cause, 5000, 'the root cause') end,
         mitigation = case when p_mitigation is null then mitigation else okr_clean(p_mitigation, 5000, 'the mitigation') end,
         owner_id = coalesce(p_owner, owner_id), target_date = coalesce(p_target, target_date),
         resolution_note = coalesce(v_note, resolution_note),
         resolved_at = case when v_to in ('RESOLVED','CLOSED') then coalesce(resolved_at, app_now()) else null end,
         version = version + 1, updated_at = app_now()
   where id = r.id;
  return jsonb_build_object('id', r.id, 'status', v_to, 'version', r.version + 1);
end $$;

-- ------------------------------------------------------------------ carry open items into a later session
-- p_items: [{ "type": "ACTION"|"RISK", "id": uuid, "outcome": "...", "remarks": "..." }]. One record per item per session (the unique key), updated if reviewed again.
create or replace function carry_forward_okr_items(p_actor uuid, p_session uuid, p_items jsonb, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s okr_sessions; v_prev jsonb; x jsonb; v_type text; v_id uuid; v_outcome text; v_remarks text; v_n int := 0; v_new boolean; a okr_session_actions; r okr_session_risks; v_res jsonb;
begin
  perform require_permission(p_actor, 'session_notes.update');
  v_prev := okr_idem(p_actor, p_key, 'carry_forward_okr_items'); if v_prev is not null then return v_prev; end if;
  s := okr_get_session(p_actor, p_session, true);
  if not okr_runs_session(p_actor, s) then raise exception 'PERMISSION_DENIED'; end if;
  perform okr_assert_open(s);
  if jsonb_array_length(okr_arr(p_items)) = 0 then raise exception 'VALIDATION_ERROR' using detail = 'choose the items to review'; end if;
  for x in select * from jsonb_array_elements(okr_arr(p_items)) loop
    v_type := x ->> 'type'; v_id := (x ->> 'id')::uuid; v_outcome := coalesce(x ->> 'outcome', 'STILL_OPEN'); v_remarks := okr_clean(x ->> 'remarks', 3000, 'the remarks');
    if v_type = 'ACTION' then
      select * into a from okr_session_actions where id = v_id;
      if not found then raise exception 'NOT_FOUND' using detail = 'action'; end if;
      if s.business_unit_id is not null and a.business_unit_id <> s.business_unit_id then raise exception 'BU_SCOPE_DENIED' using detail = 'that action belongs to another unit'; end if;
      if not okr_session_visible_to(p_actor, a.origin_session_id) then raise exception 'BU_SCOPE_DENIED'; end if;
      if a.status in ('COMPLETED','CANCELLED') and v_outcome not in ('COMPLETION_CONFIRMED','EXPLAINED') then raise exception 'INVALID_STATE_TRANSITION' using detail = 'that action is already finished'; end if;
    elsif v_type = 'RISK' then
      select * into r from okr_session_risks where id = v_id;
      if not found then raise exception 'NOT_FOUND' using detail = 'risk'; end if;
      if s.business_unit_id is not null and r.business_unit_id <> s.business_unit_id then raise exception 'BU_SCOPE_DENIED' using detail = 'that risk belongs to another unit'; end if;
      if not okr_session_visible_to(p_actor, r.session_id) then raise exception 'BU_SCOPE_DENIED'; end if;
    else raise exception 'VALIDATION_ERROR' using detail = 'unknown item type'; end if;
    if v_outcome not in ('STILL_OPEN','UPDATE_REQUESTED','EXPLAINED','COMPLETION_CONFIRMED','EXTENDED','ESCALATED','RESOLVED') then raise exception 'VALIDATION_ERROR' using detail = 'unknown outcome'; end if;
    insert into okr_session_carryovers (session_id, item_type, item_id, outcome, remarks, reviewed_by) values (s.id, v_type, v_id, v_outcome, v_remarks, p_actor)
      on conflict (session_id, item_type, item_id) do update set outcome = excluded.outcome, remarks = excluded.remarks, reviewed_by = excluded.reviewed_by, reviewed_at = app_now()
      returning (xmax = 0) into v_new;
    perform okr_log(p_actor, s.id, v_type, v_id, 'REVIEWED_IN_SESSION', jsonb_build_object('outcome', v_outcome, 'first_time_in_this_session', v_new), v_remarks);
    if v_type = 'ACTION' and v_outcome = 'UPDATE_REQUESTED' then
      perform okr_notify(p_actor, array[a.assignee_id], 'SESSION_ACTION_FOLLOW_UP', 'okr_action', a.id, 'Update requested: ' || a.reference, left(a.description, 200) || ' — it is on the agenda of session ' || s.reference || '.', 'okract:' || a.id || ':followup:' || s.id);
    end if;
    v_n := v_n + 1;
  end loop;
  v_res := jsonb_build_object('reviewed', v_n, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

-- ------------------------------------------------------------------ reminders (called by the scheduler, idempotent per action and due date)
create or replace function run_okr_session_reminders() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare a record; v_n int := 0; v_today date := okr_today_wat();
begin
  if not coalesce((select reminders_enabled from notification_settings where id), true) then return 0; end if;
  for a in select x.*, s.facilitator_id from okr_session_actions x join okr_sessions s on s.id = x.origin_session_id
           where x.status in ('OPEN','IN_PROGRESS','BLOCKED') and x.due_date <= v_today + 2 loop
    if a.due_date >= v_today then
      perform okr_notify(null, array[a.assignee_id], 'SESSION_ACTION_DUE', 'okr_action', a.id, 'Action due ' || case when a.due_date = v_today then 'today' else 'on ' || to_char(a.due_date, 'DD Mon') end || ': ' || a.reference,
                         left(a.description, 300), 'okract:' || a.id || ':due:' || a.due_date);
    else
      perform okr_notify(null, array[a.assignee_id, a.created_by, a.facilitator_id], 'SESSION_ACTION_OVERDUE', 'okr_action', a.id, 'Action overdue: ' || a.reference,
                         left(a.description, 200) || ' was due on ' || to_char(a.due_date, 'DD Mon YYYY') || '.', 'okract:' || a.id || ':overdue:' || a.due_date);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

do $$
declare v_def text; a text := 'begin perform ai_run_jobs();';
begin
  v_def := pg_get_functiondef('run_scheduled_jobs()'::regprocedure);
  if position('run_okr_session_reminders' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'run_scheduled_jobs no longer contains the expected line'; end if;
  execute replace(v_def, a, 'begin perform run_okr_session_reminders(); exception when others then get stacked diagnostics v_err = message_text; perform write_audit(null, ''JOB_FAILED'', ''job'', ''okr_session_reminders'', null, jsonb_build_object(''error'', v_err), null, null, ''FAILURE''); end; ' || a);
end $$;

select lock_down_function_grants();
