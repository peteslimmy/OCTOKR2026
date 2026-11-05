-- OKR Session Notes & Meeting Intelligence, part 3 of 3: attachments, minutes (draft -> submitted -> reviewed -> finalised), exports record, and the read models
-- (workspace, search, registers, dashboard, link pickers). Every read function is SECURITY INVOKER: the caller's own row-level security decides what comes back.

-- ------------------------------------------------------------------ attachments (the existing private 'evidence' bucket and its upload checks are reused; this table says what a file is attached to)
create table okr_session_attachments (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references okr_sessions(id) on delete restrict,
  record_type    text not null check (record_type in ('SESSION','NOTE','DECISION','ACTION','RISK')),
  record_id      uuid not null,
  purpose        text not null default 'SUPPORTING' check (purpose in ('SUPPORTING','COMPLETION_EVIDENCE')),
  file_name      text not null check (btrim(file_name) <> '' and char_length(file_name) <= 255),
  mime_type      text not null,
  size_bytes     bigint not null check (size_bytes > 0),
  checksum       text not null,
  storage_path   text not null unique,
  uploaded_by    uuid not null references users(id),
  uploaded_at    timestamptz not null default app_now(),
  deleted_at     timestamptz,
  deleted_by     uuid references users(id),
  removal_reason text
);
create index okr_session_attachments_record_idx on okr_session_attachments (record_type, record_id) where deleted_at is null;
create index okr_session_attachments_session_idx on okr_session_attachments (session_id);
create trigger okr_session_attachments_immutable before update or delete on okr_session_attachments for each row execute function forbid_mutation();   -- removal (deleted_at/by) is the only change allowed

-- ------------------------------------------------------------------ minutes
create table okr_session_minutes (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references okr_sessions(id) on delete restrict,
  revision      int  not null check (revision >= 1),
  status        text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','REVIEWED','FINALISED')),
  audience      text not null default 'PARTICIPANTS' check (audience in ('PARTICIPANTS','MANAGEMENT')),
  content       text not null check (char_length(content) <= 200000),
  ai_drafted    boolean not null default false,        -- a person must still review every word; this only records where the first draft came from
  ai_model      text,
  amends_revision int,
  snapshot      jsonb,                                  -- set at finalisation: the notes, decisions, actions and risks exactly as they stood
  content_hash  text,
  version       int not null default 1,
  created_by    uuid not null references users(id),
  created_at    timestamptz not null default app_now(),
  updated_at    timestamptz not null default app_now(),
  submitted_by  uuid references users(id),
  submitted_at  timestamptz,
  reviewed_by   uuid references users(id),
  reviewed_at   timestamptz,
  review_remarks text,
  finalised_by  uuid references users(id),
  finalised_at  timestamptz,
  unique (session_id, revision),
  check ((status = 'FINALISED') = (finalised_at is not null and content_hash is not null and snapshot is not null))
);
create unique index okr_session_minutes_working_idx on okr_session_minutes (session_id) where status in ('DRAFT','SUBMITTED','REVIEWED');   -- one working revision at a time
create index okr_session_minutes_session_idx on okr_session_minutes (session_id, revision desc);

create or replace function okr_minutes_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'minutes are never deleted'; end if;
  if old.status = 'FINALISED' then raise exception 'IMMUTABLE_RECORD' using detail = 'finalised minutes cannot change; start a new revision'; end if;
  return new;
end $$;
create trigger okr_session_minutes_guard before update or delete on okr_session_minutes for each row execute function okr_minutes_guard();

-- ------------------------------------------------------------------ row-level security
alter table okr_session_attachments enable row level security;
alter table okr_session_minutes enable row level security;
grant select on okr_session_attachments, okr_session_minutes to authenticated;
create policy read_visible on okr_session_attachments for select to authenticated using (
  (select auth_okr_session_visible(session_id)) and case record_type
    when 'NOTE' then exists (select 1 from okr_session_notes n where n.id = record_id)
    else true end);
create policy read_visible on okr_session_minutes for select to authenticated using (
  (select auth_okr_session_visible(session_id)) and (audience = 'PARTICIPANTS' or (select auth_has_permission('session_notes.view_all'))));

-- ------------------------------------------------------------------ attachments: record a stored file / remove it (the file itself stays in the private bucket)
create or replace function record_okr_attachment(
  p_actor uuid, p_session uuid, p_record_type text, p_record_id uuid, p_purpose text, p_name text, p_mime text, p_size bigint, p_checksum text, p_path text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare s okr_sessions; v_id uuid; a okr_session_actions; n okr_session_notes;
begin
  s := okr_get_session(p_actor, p_session);
  perform okr_assert_open(s);
  if p_size is null or p_size <= 0 or p_checksum is null or p_path is null or p_name is null or p_mime is null then raise exception 'VALIDATION_ERROR' using detail = 'file details are incomplete'; end if;
  if p_record_type = 'SESSION' then
    if p_record_id <> s.id then raise exception 'NOT_FOUND'; end if;
    perform require_permission(p_actor, 'session_notes.create');
  elsif p_record_type = 'NOTE' then
    perform require_permission(p_actor, 'session_notes.create');
    select * into n from okr_session_notes where id = p_record_id and session_id = s.id;
    if not found or not okr_note_visible_to(p_actor, n.session_id, n.visibility, n.author_id) then raise exception 'NOT_FOUND'; end if;
  elsif p_record_type = 'ACTION' then
    select * into a from okr_session_actions where id = p_record_id and origin_session_id = s.id;
    if not found then raise exception 'NOT_FOUND'; end if;
    if not okr_can_work_action(p_actor, a) then raise exception 'PERMISSION_DENIED' using detail = 'only the assignee, the person who set the action or an assigner can attach to it'; end if;
  elsif p_record_type = 'DECISION' then
    perform require_permission(p_actor, 'session_decisions.create');
    if not exists (select 1 from okr_session_decisions where id = p_record_id and session_id = s.id) then raise exception 'NOT_FOUND'; end if;
  elsif p_record_type = 'RISK' then
    perform require_permission(p_actor, 'session_risks.manage');
    if not exists (select 1 from okr_session_risks where id = p_record_id and session_id = s.id) then raise exception 'NOT_FOUND'; end if;
  else raise exception 'VALIDATION_ERROR' using detail = 'unknown attachment target'; end if;
  if coalesce(p_purpose, 'SUPPORTING') = 'COMPLETION_EVIDENCE' and p_record_type <> 'ACTION' then raise exception 'VALIDATION_ERROR' using detail = 'completion evidence belongs to an action'; end if;
  insert into okr_session_attachments (session_id, record_type, record_id, purpose, file_name, mime_type, size_bytes, checksum, storage_path, uploaded_by)
  values (s.id, p_record_type, p_record_id, coalesce(p_purpose, 'SUPPORTING'), left(btrim(p_name), 255), p_mime, p_size, p_checksum, p_path, p_actor) returning id into v_id;
  perform okr_log(p_actor, s.id, 'ATTACHMENT', v_id, 'ADDED', jsonb_build_object('file_name', left(btrim(p_name), 255), 'size_bytes', p_size, 'record_type', p_record_type, 'record_id', p_record_id, 'purpose', coalesce(p_purpose, 'SUPPORTING')));
  return v_id;
end $$;

create or replace function remove_okr_attachment(p_actor uuid, p_attachment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t okr_session_attachments; s okr_sessions; v_reason text := okr_clean(p_reason, 1000, 'the reason', true);
begin
  select * into t from okr_session_attachments where id = p_attachment for update;
  if not found or t.deleted_at is not null then raise exception 'NOT_FOUND'; end if;
  s := okr_get_session(p_actor, t.session_id);
  perform okr_assert_open(s);
  if t.uploaded_by <> p_actor and not okr_runs_session(p_actor, s) then raise exception 'PERMISSION_DENIED'; end if;
  update okr_session_attachments set deleted_at = app_now(), deleted_by = p_actor, removal_reason = v_reason where id = t.id;
  perform okr_log(p_actor, s.id, 'ATTACHMENT', t.id, 'REMOVED', jsonb_build_object('file_name', t.file_name), v_reason);
end $$;

-- ------------------------------------------------------------------ links on decisions, actions and risks (notes have their own: set_okr_note_link)
create or replace function set_okr_record_link(p_actor uuid, p_owner_type text, p_owner_id uuid, p_target_type text, p_target_id uuid, p_remove boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_session uuid; s okr_sessions; a okr_session_actions;
begin
  if p_owner_type = 'DECISION' then
    perform require_permission(p_actor, 'session_decisions.create');
    select session_id into v_session from okr_session_decisions where id = p_owner_id;
  elsif p_owner_type = 'RISK' then
    perform require_permission(p_actor, 'session_risks.manage');
    select session_id into v_session from okr_session_risks where id = p_owner_id;
  elsif p_owner_type = 'ACTION' then
    select * into a from okr_session_actions where id = p_owner_id;
    if found then
      if not okr_can_work_action(p_actor, a) then raise exception 'PERMISSION_DENIED'; end if;
      v_session := a.origin_session_id;
    end if;
  else raise exception 'VALIDATION_ERROR' using detail = 'unknown record type'; end if;
  if v_session is null then raise exception 'NOT_FOUND'; end if;
  s := okr_get_session(p_actor, v_session);
  perform okr_assert_open(s);
  if coalesce(p_remove, false) then
    update okr_session_links set removed_at = app_now(), removed_by = p_actor where owner_type = p_owner_type and owner_id = p_owner_id and target_type = p_target_type and target_id = p_target_id and removed_at is null;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform okr_log(p_actor, s.id, p_owner_type, p_owner_id, 'LINK_REMOVED', jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id));
  else
    perform okr_add_link(p_actor, s, p_owner_type, p_owner_id, p_target_type, p_target_id);
  end if;
end $$;

-- ------------------------------------------------------------------ minutes
-- Saves the working draft: starts one (revision 1, or the next revision when amending finalised minutes) or replaces the content of the current DRAFT.
-- The text is whatever the person (or an AI proposal they chose to keep) wrote; it becomes official only after review and finalisation by people.
create or replace function save_okr_minutes_draft(
  p_actor uuid, p_session uuid, p_content text, p_audience text, p_ai_drafted boolean, p_ai_model text, p_expected_version int, p_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s okr_sessions; m okr_session_minutes; v_prev jsonb; v_id uuid; v_rev int; v_amends int; v_aud text := coalesce(p_audience, 'PARTICIPANTS'); v_res jsonb;
begin
  perform require_permission(p_actor, 'session_notes.update');
  v_prev := okr_idem(p_actor, p_key, 'save_okr_minutes_draft'); if v_prev is not null then return v_prev; end if;
  s := okr_get_session(p_actor, p_session, true);
  if not okr_runs_session(p_actor, s) then raise exception 'PERMISSION_DENIED' using detail = 'only the facilitator, the creator or a finaliser can prepare the minutes'; end if;
  perform okr_assert_open(s);
  if s.status = 'DRAFT' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'start the session before writing its minutes'; end if;
  if v_aud not in ('PARTICIPANTS','MANAGEMENT') then raise exception 'VALIDATION_ERROR' using detail = 'unknown audience'; end if;
  if v_aud = 'MANAGEMENT' and not actor_has_permission(p_actor, 'session_notes.view_all') then raise exception 'PERMISSION_DENIED' using detail = 'minutes for management need access to every unit'; end if;
  if p_content is null or btrim(p_content) = '' or char_length(p_content) > 200000 then raise exception 'VALIDATION_ERROR' using detail = 'the minutes need content (up to 200 000 characters)'; end if;
  select * into m from okr_session_minutes where session_id = s.id and status in ('DRAFT','SUBMITTED','REVIEWED') for update;
  if found then
    if m.status <> 'DRAFT' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'these minutes are already ' || lower(m.status) || '; return them to draft first'; end if;
    perform okr_check_version(p_expected_version, m.version);
    update okr_session_minutes set content = p_content, audience = v_aud, ai_drafted = m.ai_drafted or coalesce(p_ai_drafted, false), ai_model = coalesce(p_ai_model, m.ai_model),
           version = version + 1, updated_at = app_now() where id = m.id;
    v_id := m.id; v_rev := m.revision;
    perform okr_log(p_actor, s.id, 'MINUTES', m.id, 'DRAFT_SAVED', jsonb_build_object('revision', m.revision, 'ai_drafted', m.ai_drafted or coalesce(p_ai_drafted, false)));
    v_res := jsonb_build_object('id', v_id, 'revision', v_rev, 'version', m.version + 1, 'replayed', false);
  else
    select coalesce(max(revision), 0) + 1, max(revision) into v_rev, v_amends from okr_session_minutes where session_id = s.id;
    insert into okr_session_minutes (session_id, revision, audience, content, ai_drafted, ai_model, amends_revision, created_by)
      values (s.id, v_rev, v_aud, p_content, coalesce(p_ai_drafted, false), p_ai_model, v_amends, p_actor) returning id into v_id;
    perform okr_log(p_actor, s.id, 'MINUTES', v_id, 'DRAFT_STARTED', jsonb_build_object('revision', v_rev, 'amends_revision', v_amends, 'ai_drafted', coalesce(p_ai_drafted, false)));
    v_res := jsonb_build_object('id', v_id, 'revision', v_rev, 'version', 1, 'replayed', false);
  end if;
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

create or replace function submit_okr_minutes(p_actor uuid, p_minutes uuid, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare m okr_session_minutes; s okr_sessions; v_users uuid[];
begin
  perform require_permission(p_actor, 'session_notes.update');
  select * into m from okr_session_minutes where id = p_minutes for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  s := okr_get_session(p_actor, m.session_id);
  if not okr_runs_session(p_actor, s) then raise exception 'PERMISSION_DENIED'; end if;
  perform okr_assert_open(s);
  perform okr_check_version(p_expected_version, m.version);
  if m.status <> 'DRAFT' then raise exception 'INVALID_STATE_TRANSITION'; end if;
  update okr_session_minutes set status = 'SUBMITTED', submitted_by = p_actor, submitted_at = app_now(), version = version + 1, updated_at = app_now() where id = m.id;
  perform okr_log(p_actor, s.id, 'MINUTES', m.id, 'SUBMITTED', jsonb_build_object('revision', m.revision));
  select coalesce(array_agg(u), '{}') into v_users from unnest(users_with_permission('session_notes.finalise')) u where okr_session_visible_to(u, s.id);
  perform okr_notify(p_actor, v_users, 'SESSION_MINUTES_REVIEW', 'okr_session', s.id, 'Minutes ready for review: ' || s.reference, 'The minutes of "' || left(s.title, 120) || '" (revision ' || m.revision || ') await your review.', 'okrmin:' || m.id || ':submitted');
  return jsonb_build_object('id', m.id, 'version', m.version + 1, 'status', 'SUBMITTED');
end $$;

-- APPROVE: SUBMITTED -> REVIEWED. RETURN: SUBMITTED -> DRAFT, with remarks.
create or replace function review_okr_minutes(p_actor uuid, p_minutes uuid, p_outcome text, p_remarks text, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare m okr_session_minutes; s okr_sessions; v_remarks text := okr_clean(p_remarks, 3000, 'the remarks'); v_to text;
begin
  perform require_permission(p_actor, 'session_notes.finalise');
  select * into m from okr_session_minutes where id = p_minutes for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  s := okr_get_session(p_actor, m.session_id);
  perform okr_assert_open(s);
  perform okr_check_version(p_expected_version, m.version);
  if m.status <> 'SUBMITTED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'only minutes submitted for review can be reviewed'; end if;
  if p_outcome not in ('APPROVE','RETURN') then raise exception 'VALIDATION_ERROR' using detail = 'choose approve or return'; end if;
  if p_outcome = 'RETURN' and v_remarks is null then raise exception 'REASON_REQUIRED' using detail = 'say what needs to change'; end if;
  v_to := case p_outcome when 'APPROVE' then 'REVIEWED' else 'DRAFT' end;
  update okr_session_minutes set status = v_to, reviewed_by = p_actor, reviewed_at = app_now(), review_remarks = v_remarks, version = version + 1, updated_at = app_now() where id = m.id;
  perform okr_log(p_actor, s.id, 'MINUTES', m.id, case v_to when 'REVIEWED' then 'REVIEWED' else 'RETURNED' end, jsonb_build_object('revision', m.revision), v_remarks);
  if v_to = 'DRAFT' then
    perform okr_notify(p_actor, array[m.created_by, m.submitted_by], 'SESSION_MINUTES_REVIEW', 'okr_session', s.id, 'Minutes returned: ' || s.reference, 'The minutes were returned for changes. ' || coalesce(left(v_remarks, 300), ''), 'okrmin:' || m.id || ':returned:' || (m.version + 1));
  end if;
  return jsonb_build_object('id', m.id, 'version', m.version + 1, 'status', v_to);
end $$;

-- freezes the revision together with a copy of the notes, decisions, actions and risks as they stand; the notes themselves stay as they are
create or replace function finalise_okr_minutes(p_actor uuid, p_minutes uuid, p_expected_version int, p_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare m okr_session_minutes; s okr_sessions; v_prev jsonb; v_snap jsonb; v_hash text; v_res jsonb; v_mgmt boolean;
begin
  perform require_permission(p_actor, 'session_notes.finalise');
  v_prev := okr_idem(p_actor, p_key, 'finalise_okr_minutes'); if v_prev is not null then return v_prev; end if;
  select * into m from okr_session_minutes where id = p_minutes for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  s := okr_get_session(p_actor, m.session_id, true);
  perform okr_assert_open(s);
  perform okr_check_version(p_expected_version, m.version);
  if m.status <> 'REVIEWED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'minutes must be reviewed before they are finalised'; end if;
  if s.status <> 'COMPLETED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'complete the session before finalising its minutes'; end if;
  v_mgmt := m.audience = 'MANAGEMENT';
  v_snap := jsonb_build_object(
    'session', jsonb_build_object('reference', s.reference, 'title', s.title, 'session_date', s.session_date, 'status', s.status, 'version', s.version),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'category', n.category, 'title', n.title, 'content', n.content, 'visibility', n.visibility, 'author_id', n.author_id, 'version', n.version, 'noted_at', n.noted_at) order by n.noted_at), '[]'::jsonb)
              from okr_session_notes n where n.session_id = s.id and n.status = 'ACTIVE' and (n.visibility = 'SHARED' or (v_mgmt and n.visibility = 'MANAGEMENT'))),
    'decisions', (select coalesce(jsonb_agg(to_jsonb(d) - 'client_key' order by d.created_at), '[]'::jsonb) from okr_session_decisions d where d.session_id = s.id),
    'actions', (select coalesce(jsonb_agg(to_jsonb(a) - 'client_key' order by a.created_at), '[]'::jsonb) from okr_session_actions a where a.origin_session_id = s.id),
    'risks', (select coalesce(jsonb_agg(to_jsonb(r) - 'client_key' - 'fingerprint' order by r.created_at), '[]'::jsonb) from okr_session_risks r where r.session_id = s.id));
  v_hash := encode(sha256(convert_to(m.content || v_snap::text, 'utf8')), 'hex');
  update okr_session_minutes set status = 'FINALISED', finalised_by = p_actor, finalised_at = app_now(), snapshot = v_snap, content_hash = v_hash, version = version + 1, updated_at = app_now() where id = m.id;
  perform okr_log(p_actor, s.id, 'MINUTES', m.id, 'FINALISED', jsonb_build_object('revision', m.revision, 'content_hash', v_hash, 'amends_revision', m.amends_revision, 'ai_drafted', m.ai_drafted));
  perform okr_notify(p_actor, okr_session_audience(s.id) || m.created_by, 'SESSION_MINUTES_FINAL', 'okr_session', s.id, 'Minutes finalised: ' || s.reference, 'The minutes of "' || left(s.title, 120) || '" (revision ' || m.revision || ') are final.', 'okrmin:' || m.id || ':final');
  v_res := jsonb_build_object('id', m.id, 'status', 'FINALISED', 'revision', m.revision, 'content_hash', v_hash, 'replayed', false);
  return okr_idem_done(p_actor, p_key, v_res);
end $$;

-- ------------------------------------------------------------------ exports and AI use are recorded (who, what, which filters, how many rows)
create or replace function record_okr_export(p_actor uuid, p_kind text, p_session uuid, p_format text, p_params jsonb, p_rows int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_permission(p_actor, 'session_notes.export');
  if p_session is not null then
    perform okr_get_session(p_actor, p_session);
    perform okr_log(p_actor, p_session, 'SESSION', p_session, 'EXPORTED', jsonb_build_object('kind', p_kind, 'format', p_format, 'rows', p_rows));
  else
    perform write_audit(p_actor, 'OKR_SESSION_EXPORTED', 'okr_export', p_kind, null, jsonb_build_object('format', p_format, 'rows', p_rows, 'params', p_params));
  end if;
end $$;

create or replace function record_okr_ai_summary(p_actor uuid, p_session uuid, p_model text, p_ok boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform okr_get_session(p_actor, p_session);
  perform okr_log(p_actor, p_session, 'MINUTES', null, case when p_ok then 'AI_SUMMARY_PROPOSED' else 'AI_SUMMARY_FAILED' end, jsonb_build_object('model', p_model, 'reason', p_reason));
end $$;

-- ================================================================== read models (security invoker; row-level security applies)

create or replace function read_okr_user_state(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from users u join employees e on e.id = u.employee_id where u.id = p_user and u.status = 'ACTIVE' and e.employment_status = 'ACTIVE');
$$;

create or replace function read_okr_links_json(p_type text, p_id uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'target_type', l.target_type, 'target_id', l.target_id, 'label', l.label, 'business_unit_id', l.target_bu_id) order by l.created_at), '[]'::jsonb)
    from okr_session_links l where l.owner_type = p_type and l.owner_id = p_id and l.removed_at is null;
$$;

create or replace function read_okr_action_json(a okr_session_actions) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select (to_jsonb(a) - 'client_key') || jsonb_build_object(
    'assignee_name', person_name(a.assignee_id), 'created_by_name', person_name(a.created_by), 'completed_by_name', person_name(a.completed_by),
    'business_unit_name', (select name from business_units where id = a.business_unit_id),
    'origin_session_reference', (select reference from okr_sessions where id = a.origin_session_id),
    'overdue', a.status in ('OPEN','IN_PROGRESS','BLOCKED') and a.due_date < (app_now() at time zone 'Africa/Lagos')::date,
    'due_soon', a.status in ('OPEN','IN_PROGRESS','BLOCKED') and a.due_date between (app_now() at time zone 'Africa/Lagos')::date and (app_now() at time zone 'Africa/Lagos')::date + 2,
    'reviews', (select count(*) from okr_session_carryovers c where c.item_type = 'ACTION' and c.item_id = a.id),
    'assignee_unavailable', not read_okr_user_state(a.assignee_id),
    'links', read_okr_links_json('ACTION', a.id),
    'attachments', (select count(*) from okr_session_attachments t where t.record_type = 'ACTION' and t.record_id = a.id and t.deleted_at is null));
$$;

create or replace function read_okr_risk_json(r okr_session_risks) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select (to_jsonb(r) - 'client_key' - 'fingerprint') || jsonb_build_object(
    'owner_name', person_name(r.owner_id), 'created_by_name', person_name(r.created_by),
    'business_unit_name', (select name from business_units where id = r.business_unit_id),
    'session_reference', (select reference from okr_sessions where id = r.session_id),
    'overdue', r.status in ('OPEN','MITIGATING') and r.target_date is not null and r.target_date < (app_now() at time zone 'Africa/Lagos')::date,
    'reviews', (select count(*) from okr_session_carryovers c where c.item_type = 'RISK' and c.item_id = r.id),
    'raised_in_sessions', (select count(distinct x.session_id) from okr_session_risks x where x.business_unit_id = r.business_unit_id and x.fingerprint = r.fingerprint),
    'links', read_okr_links_json('RISK', r.id));
$$;

create or replace function read_okr_decision_json(d okr_session_decisions) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select (to_jsonb(d) - 'client_key') || jsonb_build_object(
    'created_by_name', person_name(d.created_by), 'decided_by_name', person_name(d.decided_by),
    'session_reference', (select reference from okr_sessions where id = d.session_id),
    'affected_bu_name', (select name from business_units where id = d.affected_bu_id),
    'involved', (select coalesce(jsonb_agg(person_name(u)), '[]'::jsonb) from unnest(d.involved_user_ids) u),
    'superseded_by_reference', (select reference from okr_session_decisions where id = d.superseded_by_id),
    'supersedes_reference', (select reference from okr_session_decisions where id = d.supersedes_id),
    'links', read_okr_links_json('DECISION', d.id),
    'attachments', (select count(*) from okr_session_attachments t where t.record_type = 'DECISION' and t.record_id = d.id and t.deleted_at is null));
$$;

-- the whole session workspace in one call
create or replace function read_okr_session(p_session uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare s okr_sessions; v_me uuid := auth.uid();
begin
  select * into s from okr_sessions where id = p_session;
  if not found then return null; end if;
  return jsonb_build_object(
    'session', (to_jsonb(s)) || jsonb_build_object(
      'type_name', (select name from okr_session_types where id = s.session_type_id), 'type_code', (select code from okr_session_types where id = s.session_type_id),
      'business_unit_name', (select name from business_units where id = s.business_unit_id),
      'facilitator_name', person_name(s.facilitator_id), 'created_by_name', person_name(s.created_by), 'completed_by_name', person_name(s.completed_by),
      'quarter_label', (select 'Q' || quarter_number || ' ' || year from quarters where id = s.quarter_id),
      'quarter_status', (select status from quarters where id = s.quarter_id),
      'week', (select jsonb_build_object('id', w.id, 'week_number', w.week_number, 'week_year', w.week_year, 'week_start_at', w.week_start_at, 'status', w.status, 'reporting_state', w.reporting_state) from reporting_weeks w where w.id = s.reporting_week_id),
      'attendance_session', (select jsonb_build_object('id', g.id, 'session_date', g.session_date, 'outcome', g.outcome) from governance_sessions g where g.id = s.governance_session_id)),
    'viewer', jsonb_build_object('id', v_me, 'is_facilitator', s.facilitator_id = v_me, 'is_creator', s.created_by = v_me),
    'participants', (select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', person_name(p.user_id), 'role', p.role, 'removed_at', p.removed_at) order by p.added_at), '[]'::jsonb) from okr_session_participants p where p.session_id = s.id),
    'notes', (select coalesce(jsonb_agg((to_jsonb(n) - 'client_key') || jsonb_build_object('author_name', person_name(n.author_id), 'last_edited_by_name', person_name(n.last_edited_by),
                'links', read_okr_links_json('NOTE', n.id), 'attachments', (select count(*) from okr_session_attachments t where t.record_type = 'NOTE' and t.record_id = n.id and t.deleted_at is null),
                'versions', (select count(*) from okr_session_note_versions v where v.note_id = n.id)) order by n.noted_at, n.created_at), '[]'::jsonb) from okr_session_notes n where n.session_id = s.id),
    'decisions', (select coalesce(jsonb_agg(read_okr_decision_json(d) order by d.created_at), '[]'::jsonb) from okr_session_decisions d where d.session_id = s.id),
    'actions', (select coalesce(jsonb_agg(read_okr_action_json(a) order by a.due_date, a.created_at), '[]'::jsonb) from okr_session_actions a where a.origin_session_id = s.id),
    'risks', (select coalesce(jsonb_agg(read_okr_risk_json(r) order by r.created_at), '[]'::jsonb) from okr_session_risks r where r.session_id = s.id),
    'reviewed_here', (select coalesce(jsonb_agg(jsonb_build_object('item_type', c.item_type, 'item_id', c.item_id, 'outcome', c.outcome, 'remarks', c.remarks, 'reviewed_by_name', person_name(c.reviewed_by), 'reviewed_at', c.reviewed_at,
                'record', case c.item_type when 'ACTION' then (select read_okr_action_json(a) from okr_session_actions a where a.id = c.item_id) else (select read_okr_risk_json(r) from okr_session_risks r where r.id = c.item_id) end) order by c.reviewed_at), '[]'::jsonb)
                from okr_session_carryovers c where c.session_id = s.id),
    'minutes', (select coalesce(jsonb_agg((to_jsonb(m) - 'snapshot') || jsonb_build_object('created_by_name', person_name(m.created_by), 'submitted_by_name', person_name(m.submitted_by), 'reviewed_by_name', person_name(m.reviewed_by),
                'finalised_by_name', person_name(m.finalised_by)) order by m.revision desc), '[]'::jsonb) from okr_session_minutes m where m.session_id = s.id),
    'attachments', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'record_type', t.record_type, 'record_id', t.record_id, 'purpose', t.purpose, 'file_name', t.file_name, 'mime_type', t.mime_type, 'size_bytes', t.size_bytes,
                'uploaded_by_name', person_name(t.uploaded_by), 'uploaded_at', t.uploaded_at) order by t.uploaded_at desc), '[]'::jsonb) from okr_session_attachments t where t.session_id = s.id and t.deleted_at is null),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('seq', e.seq, 'record_type', e.record_type, 'record_id', e.record_id, 'event_type', e.event_type, 'actor_name', person_name(e.actor_id), 'details', e.details, 'remarks', e.remarks, 'occurred_at', e.occurred_at) order by e.seq desc), '[]'::jsonb)
                from (select * from okr_session_events x where x.session_id = s.id order by x.seq desc limit 300) e)
  );
end $$;

-- every earlier version of one note
create or replace function read_okr_note_versions(p_note uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'category', v.category, 'title', v.title, 'content', v.content, 'visibility', v.visibility, 'status', v.status,
           'saved_by_name', person_name(v.saved_by), 'saved_at', v.saved_at, 'superseded_by_name', person_name(v.superseded_by), 'superseded_at', v.superseded_at, 'change_kind', v.change_kind, 'reason', v.reason)
           order by v.version desc, v.superseded_at desc), '[]'::jsonb)
    from okr_session_note_versions v where v.note_id = p_note;
$$;

-- the finalised snapshot of one minutes revision (so a finalised record can be reopened exactly as it was)
create or replace function read_okr_minutes(p_minutes uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select to_jsonb(m) || jsonb_build_object('created_by_name', person_name(m.created_by), 'finalised_by_name', person_name(m.finalised_by), 'reviewed_by_name', person_name(m.reviewed_by),
         'session_reference', (select reference from okr_sessions where id = m.session_id)) from okr_session_minutes m where m.id = p_minutes;
$$;

-- open commitments and risks of the same unit from earlier sessions: what to review in this session
create or replace function read_okr_outstanding(p_session uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare s okr_sessions;
begin
  select * into s from okr_sessions where id = p_session;
  if not found then return null; end if;
  return jsonb_build_object(
    'actions', (select coalesce(jsonb_agg(read_okr_action_json(a) order by a.due_date), '[]'::jsonb) from okr_session_actions a
                where a.origin_session_id <> s.id and (a.status in ('OPEN','IN_PROGRESS','BLOCKED') or (a.status = 'COMPLETED' and a.verification_status = 'PENDING'))
                  and (s.business_unit_id is null or a.business_unit_id = s.business_unit_id)
                  and exists (select 1 from okr_sessions o where o.id = a.origin_session_id and o.session_date <= s.session_date)),
    'risks', (select coalesce(jsonb_agg(read_okr_risk_json(r) order by r.created_at), '[]'::jsonb) from okr_session_risks r
                where r.session_id <> s.id and r.status in ('OPEN','MITIGATING') and (s.business_unit_id is null or r.business_unit_id = s.business_unit_id)
                  and exists (select 1 from okr_sessions o where o.id = r.session_id and o.session_date <= s.session_date)));
end $$;

-- the searchable session library. Every filter is optional. Keyword search covers notes, decisions, actions and risks the caller is allowed to read.
create or replace function read_okr_session_search(
  p_q text, p_bu uuid, p_quarter uuid, p_week uuid, p_from date, p_to date, p_type uuid, p_facilitator uuid, p_participant uuid, p_status text, p_note_category text,
  p_decision_status text, p_action_status text, p_link_type text, p_link_id uuid, p_limit int, p_offset int
) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_tq tsquery := case when nullif(btrim(coalesce(p_q, '')), '') is null then null else websearch_to_tsquery('simple', p_q) end; v_total int; v_rows jsonb; v_ids uuid[];
begin
  select coalesce(array_agg(s.id), '{}') into v_ids from okr_sessions s
   where (p_bu is null or s.business_unit_id = p_bu) and (p_quarter is null or s.quarter_id = p_quarter) and (p_week is null or s.reporting_week_id = p_week)
     and (p_from is null or s.session_date >= p_from) and (p_to is null or s.session_date <= p_to) and (p_type is null or s.session_type_id = p_type)
     and (p_facilitator is null or s.facilitator_id = p_facilitator) and (p_status is null or s.status = p_status)
     and (p_participant is null or exists (select 1 from okr_session_participants pp where pp.session_id = s.id and pp.user_id = p_participant and pp.removed_at is null))
     and (p_note_category is null or exists (select 1 from okr_session_notes n where n.session_id = s.id and n.category = p_note_category and n.status = 'ACTIVE'))
     and (p_decision_status is null or exists (select 1 from okr_session_decisions d where d.session_id = s.id and d.status = p_decision_status))
     and (p_action_status is null or exists (select 1 from okr_session_actions a where a.origin_session_id = s.id and a.status = p_action_status))
     and (p_link_id is null or exists (select 1 from okr_session_links l where l.session_id = s.id and l.target_id = p_link_id and l.removed_at is null and (p_link_type is null or l.target_type = p_link_type)))
     and (v_tq is null
          or to_tsvector('simple', s.title || ' ' || coalesce(s.description, '') || ' ' || s.reference) @@ v_tq
          or exists (select 1 from okr_session_notes n where n.session_id = s.id and n.status = 'ACTIVE' and to_tsvector('simple', coalesce(n.title, '') || ' ' || n.content) @@ v_tq)
          or exists (select 1 from okr_session_decisions d where d.session_id = s.id and to_tsvector('simple', d.title || ' ' || d.description) @@ v_tq)
          or exists (select 1 from okr_session_actions a where a.origin_session_id = s.id and to_tsvector('simple', a.description) @@ v_tq)
          or exists (select 1 from okr_session_risks r where r.session_id = s.id and to_tsvector('simple', r.title || ' ' || r.description) @@ v_tq));
  v_total := cardinality(v_ids);
  select coalesce(jsonb_agg(row order by (row ->> 'session_date') desc, (row ->> 'reference') desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', s.id, 'reference', s.reference, 'title', s.title, 'status', s.status, 'session_date', s.session_date, 'type_name', t.name,
      'business_unit_id', s.business_unit_id, 'business_unit_name', b.name, 'facilitator_name', person_name(s.facilitator_id),
      'quarter_label', (select 'Q' || quarter_number || ' ' || year from quarters where id = s.quarter_id),
      'week_number', w.week_number, 'week_year', w.week_year, 'reporting_week_id', s.reporting_week_id,
      'notes', (select count(*) from okr_session_notes n where n.session_id = s.id and n.status = 'ACTIVE'),
      'decisions', (select count(*) from okr_session_decisions d where d.session_id = s.id),
      'open_actions', (select count(*) from okr_session_actions a where a.origin_session_id = s.id and a.status in ('OPEN','IN_PROGRESS','BLOCKED')),
      'risks', (select count(*) from okr_session_risks r where r.session_id = s.id),
      'minutes_status', (select m.status from okr_session_minutes m where m.session_id = s.id order by m.revision desc limit 1),
      'snippets', case when v_tq is null then '[]'::jsonb else (select coalesce(jsonb_agg(ts_headline('simple', left(coalesce(n.title, '') || ' ' || n.content, 2000), v_tq, 'MaxWords=24, MinWords=8, StartSel=[[, StopSel=]]')), '[]'::jsonb)
           from (select * from okr_session_notes n2 where n2.session_id = s.id and n2.status = 'ACTIVE' and to_tsvector('simple', coalesce(n2.title, '') || ' ' || n2.content) @@ v_tq limit 3) n) end
    ) as row
    from okr_sessions s join okr_session_types t on t.id = s.session_type_id left join business_units b on b.id = s.business_unit_id left join reporting_weeks w on w.id = s.reporting_week_id
    where s.id = any(v_ids) order by s.session_date desc, s.reference desc limit least(coalesce(p_limit, 25), 100) offset greatest(coalesce(p_offset, 0), 0)) q;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- the decisions, actions and risks registers across sessions (filters optional)
create or replace function read_okr_decisions(p_bu uuid, p_quarter uuid, p_status text, p_from date, p_to date, p_limit int) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(read_okr_decision_json(d) order by d.decision_date desc, d.reference desc), '[]'::jsonb) from (
    select d.* from okr_session_decisions d join okr_sessions s on s.id = d.session_id
     where (p_bu is null or d.affected_bu_id = p_bu) and (p_quarter is null or s.quarter_id = p_quarter) and (p_status is null or d.status = p_status)
       and (p_from is null or d.decision_date >= p_from) and (p_to is null or d.decision_date <= p_to)
     order by d.decision_date desc, d.reference desc limit least(coalesce(p_limit, 200), 1000)) d;
$$;

create or replace function read_okr_actions(p_bu uuid, p_quarter uuid, p_status text, p_assignee uuid, p_overdue boolean, p_from date, p_to date, p_limit int) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(read_okr_action_json(a) order by a.due_date, a.reference), '[]'::jsonb) from (
    select a.* from okr_session_actions a join okr_sessions s on s.id = a.origin_session_id
     where (p_bu is null or a.business_unit_id = p_bu) and (p_quarter is null or s.quarter_id = p_quarter) and (p_status is null or a.status = p_status)
       and (p_assignee is null or a.assignee_id = p_assignee)
       and (not coalesce(p_overdue, false) or (a.status in ('OPEN','IN_PROGRESS','BLOCKED') and a.due_date < (app_now() at time zone 'Africa/Lagos')::date))
       and (p_from is null or a.due_date >= p_from) and (p_to is null or a.due_date <= p_to)
     order by a.due_date, a.reference limit least(coalesce(p_limit, 200), 1000)) a;
$$;

create or replace function read_okr_risks(p_bu uuid, p_quarter uuid, p_status text, p_severity text, p_open_only boolean, p_limit int) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(read_okr_risk_json(r) order by r.created_at desc), '[]'::jsonb) from (
    select r.* from okr_session_risks r join okr_sessions s on s.id = r.session_id
     where (p_bu is null or r.business_unit_id = p_bu) and (p_quarter is null or s.quarter_id = p_quarter) and (p_status is null or r.status = p_status)
       and (p_severity is null or r.severity = p_severity) and (not coalesce(p_open_only, false) or r.status in ('OPEN','MITIGATING'))
     order by r.created_at desc limit least(coalesce(p_limit, 200), 1000)) r;
$$;

-- dashboard: every figure is counted from the records the caller may read
create or replace function read_okr_dashboard(p_quarter uuid, p_bu uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_today date := (app_now() at time zone 'Africa/Lagos')::date; r jsonb; v_ids uuid[];
begin
  select coalesce(array_agg(s.id), '{}') into v_ids from okr_sessions s where s.status <> 'ARCHIVED' and (p_quarter is null or s.quarter_id = p_quarter) and (p_bu is null or s.business_unit_id = p_bu)
     and (p_from is null or s.session_date >= p_from) and (p_to is null or s.session_date <= p_to);
  r := jsonb_build_object(
    'sessions_total', cardinality(v_ids),
    'sessions_by_status', (select coalesce(jsonb_object_agg(status, c), '{}'::jsonb) from (select s.status, count(*) c from okr_sessions s where s.id = any(v_ids) group by s.status) q),
    'sessions_by_bu', (select coalesce(jsonb_agg(jsonb_build_object('business_unit_id', bid, 'name', coalesce(name, 'Organisation-wide'), 'sessions', c) order by c desc), '[]'::jsonb)
                       from (select s.business_unit_id bid, b.name, count(*) c from okr_sessions s left join business_units b on b.id = s.business_unit_id where s.id = any(v_ids) group by s.business_unit_id, b.name) q),
    'sessions_by_week', (select coalesce(jsonb_agg(jsonb_build_object('week_id', wid, 'label', 'Week ' || wn || ' ' || wy, 'quarter', ql, 'sessions', c) order by wy, wn), '[]'::jsonb)
                         from (select w.id wid, w.week_number wn, w.week_year wy, 'Q' || qq.quarter_number || ' ' || qq.year ql, count(*) c from okr_sessions s join reporting_weeks w on w.id = s.reporting_week_id join quarters qq on qq.id = w.quarter_id
                               where s.id = any(v_ids) group by w.id, w.week_number, w.week_year, qq.quarter_number, qq.year) q),
    'sessions_by_quarter', (select coalesce(jsonb_agg(jsonb_build_object('quarter_id', qid, 'label', ql, 'sessions', c) order by qy desc, qn desc), '[]'::jsonb)
                            from (select qq.id qid, 'Q' || qq.quarter_number || ' ' || qq.year ql, qq.year qy, qq.quarter_number qn, count(*) c from okr_sessions s join quarters qq on qq.id = s.quarter_id
                                  where s.id = any(v_ids) group by qq.id, qq.quarter_number, qq.year) q),
    'sessions_without_week', (select count(*) from okr_sessions s where s.id = any(v_ids) and s.reporting_week_id is null),
    'awaiting_finalisation', (select count(*) from okr_sessions s where s.id = any(v_ids) and s.status = 'COMPLETED'
                              and coalesce((select m.status from okr_session_minutes m where m.session_id = s.id order by m.revision desc limit 1), 'NONE') <> 'FINALISED'),
    'decisions_total', (select count(*) from okr_session_decisions d where d.session_id = any(v_ids)),
    'decisions_by_status', (select coalesce(jsonb_object_agg(status, c), '{}'::jsonb) from (select d.status, count(*) c from okr_session_decisions d where d.session_id = any(v_ids) group by d.status) q),
    'actions_total', (select count(*) from okr_session_actions a where a.origin_session_id = any(v_ids)),
    'actions_by_status', (select coalesce(jsonb_object_agg(status, c), '{}'::jsonb) from (select a.status, count(*) c from okr_session_actions a where a.origin_session_id = any(v_ids) group by a.status) q),
    'actions_outstanding', (select count(*) from okr_session_actions a where a.origin_session_id = any(v_ids) and a.status in ('OPEN','IN_PROGRESS','BLOCKED')),
    'actions_overdue', (select count(*) from okr_session_actions a where a.origin_session_id = any(v_ids) and a.status in ('OPEN','IN_PROGRESS','BLOCKED') and a.due_date < v_today),
    'actions_due_soon', (select count(*) from okr_session_actions a where a.origin_session_id = any(v_ids) and a.status in ('OPEN','IN_PROGRESS','BLOCKED') and a.due_date between v_today and v_today + 2),
    'actions_blocked', (select count(*) from okr_session_actions a where a.origin_session_id = any(v_ids) and a.status = 'BLOCKED'),
    'actions_awaiting_verification', (select count(*) from okr_session_actions a where a.origin_session_id = any(v_ids) and a.status = 'COMPLETED' and a.verification_status = 'PENDING'),
    'actions_carried', (select count(*) from okr_session_actions a where a.origin_session_id = any(v_ids) and a.status in ('OPEN','IN_PROGRESS','BLOCKED')
                        and (select count(*) from okr_session_carryovers c where c.item_type = 'ACTION' and c.item_id = a.id) >= 1),
    'actions_repeatedly_carried', (select coalesce(jsonb_agg(read_okr_action_json(a) order by a.due_date), '[]'::jsonb) from okr_session_actions a where a.origin_session_id = any(v_ids) and a.status in ('OPEN','IN_PROGRESS','BLOCKED')
                        and (select count(*) from okr_session_carryovers c where c.item_type = 'ACTION' and c.item_id = a.id) >= 3),
    'completion_rate', (select case when count(*) filter (where a.status <> 'CANCELLED') = 0 then null
                         else round(100.0 * count(*) filter (where a.status = 'COMPLETED') / count(*) filter (where a.status <> 'CANCELLED'), 1) end
                        from okr_session_actions a where a.origin_session_id = any(v_ids)),
    'risks_open', (select count(*) from okr_session_risks x where x.session_id = any(v_ids) and x.status in ('OPEN','MITIGATING')),
    'risks_by_severity', (select coalesce(jsonb_object_agg(severity, c), '{}'::jsonb) from (select x.severity, count(*) c from okr_session_risks x where x.session_id = any(v_ids) and x.status in ('OPEN','MITIGATING') group by x.severity) q),
    'risks_overdue', (select count(*) from okr_session_risks x where x.session_id = any(v_ids) and x.status in ('OPEN','MITIGATING') and x.target_date is not null and x.target_date < v_today),
    'repeated_issues', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'business_unit_id', bid, 'business_unit_name', (select name from business_units where id = bid), 'sessions', n, 'unresolved', open_n) order by n desc, open_n desc), '[]'::jsonb)
                        from (select min(x.title) title, x.business_unit_id bid, count(distinct x.session_id) n, count(*) filter (where x.status in ('OPEN','MITIGATING')) open_n
                              from okr_session_risks x where x.session_id = any(v_ids) group by x.business_unit_id, x.fingerprint having count(distinct x.session_id) >= 2) q));
  return r;
end $$;

-- OKR components to link to, for one unit and week: what is current, so nobody has to search the whole structure
create or replace function read_okr_link_options(p_bu uuid, p_week uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_q uuid; v_theme uuid; v_year int; v_report uuid;
begin
  select quarter_id into v_q from reporting_weeks where id = p_week;
  if v_q is null then select id into v_q from quarters where status = 'ACTIVE' limit 1; end if;
  select year into v_year from quarters where id = v_q;
  select id into v_theme from annual_themes where year = v_year limit 1;
  select id into v_report from weekly_reports where business_unit_id = p_bu and reporting_week_id = p_week;
  return jsonb_build_object(
    'theme', (select jsonb_build_object('type', 'ANNUAL_THEME', 'id', t.id, 'label', 'Annual theme ' || t.year || ': ' || t.theme) from annual_themes t where t.id = v_theme),
    'quarter', (select jsonb_build_object('type', 'QUARTER', 'id', q.id, 'label', 'Q' || q.quarter_number || ' ' || q.year) from quarters q where q.id = v_q),
    'objective', (select jsonb_build_object('type', 'OBJECTIVE', 'id', o.id, 'label', o.title) from quarterly_objectives o where o.quarter_id = v_q),
    'key_results', (select coalesce(jsonb_agg(jsonb_build_object('type', 'KEY_RESULT', 'id', k.id, 'label', k.code || ': ' || k.title) order by k.sequence), '[]'::jsonb) from key_results k join quarterly_objectives o on o.id = k.objective_id where o.quarter_id = v_q),
    'sub_key_results', (select coalesce(jsonb_agg(jsonb_build_object('type', 'SUB_KEY_RESULT', 'id', sk.id, 'label', sk.code || ': ' || sk.title, 'key_result_id', sk.key_result_id) order by k.sequence, sk.sequence), '[]'::jsonb)
                        from sub_key_results sk join key_results k on k.id = sk.key_result_id join quarterly_objectives o on o.id = k.objective_id where o.quarter_id = v_q),
    'bu_goals', (select coalesce(jsonb_agg(jsonb_build_object('type', 'BU_GOAL', 'id', g.id, 'label', g.title) order by g.position), '[]'::jsonb) from bu_goals g where g.business_unit_id = p_bu and g.quarter_id = v_q and g.status = 'ACTIVE'),
    'weekly_report', (select jsonb_build_object('type', 'WEEKLY_REPORT', 'id', r.id, 'label', 'Weekly report, week ' || w.week_number || ' ' || w.week_year) from weekly_reports r join reporting_weeks w on w.id = r.reporting_week_id where r.id = v_report),
    'weekly_goals', (select coalesce(jsonb_agg(jsonb_build_object('type', 'WEEKLY_GOAL', 'id', g.id, 'label', g.title) order by g.position), '[]'::jsonb) from smart_goals g where g.weekly_report_id = v_report and g.deleted_at is null),
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object('type', 'TASK', 'id', t.id, 'label', left(t.description, 120), 'goal_id', t.smart_goal_id) order by t.position), '[]'::jsonb) from tasks t join smart_goals g on g.id = t.smart_goal_id where g.weekly_report_id = v_report and t.deleted_at is null and g.deleted_at is null));
end $$;

-- people who can be chosen as facilitator, participant, assignee or owner (names and unit only)
create or replace function read_okr_people() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not auth_has_any(array['session_notes.view','session_actions.update','session_actions.create']) then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', e.first_name || ' ' || e.last_name, 'business_unit_id', e.business_unit_id, 'business_unit_name', b.name,
            'can_view_sessions', actor_has_permission(u.id, 'session_notes.view')) order by e.first_name, e.last_name), '[]'::jsonb)
          from users u join employees e on e.id = u.employee_id join business_units b on b.id = e.business_unit_id
          where u.status = 'ACTIVE' and e.employment_status = 'ACTIVE' and not is_super_admin(u.id));
end $$;

select lock_down_function_grants();
