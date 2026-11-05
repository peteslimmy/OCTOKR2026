-- OKR Session Notes: mentions (ADR-094).
-- A note can mention a colleague with the token  @[Full name](user:<uuid>)  (the editor inserts it from the session's participants).
-- When a note is saved, each mentioned person who is ALLOWED TO READ THAT NOTE (session access and the note's classification) gets one notice per note;
-- a person who could not read it is never told it exists, so a mention can never leak a management-only or confidential note.
-- The notice names the session, not the note's words. It follows the same email preference as every other event.

insert into email_event_types (event_type, mandatory, description) values ('SESSION_MENTION', false, 'You were mentioned in an OKR session note')
on conflict do nothing;

create or replace function okr_notify_note_mentions() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare s okr_sessions; m text[]; v_user uuid; v_by text;
begin
  if new.status <> 'ACTIVE' or new.content is null or position('(user:' in new.content) = 0 then return new; end if;
  if tg_op = 'UPDATE' and new.content = old.content then return new; end if;
  select * into s from okr_sessions where id = new.session_id;
  select e.first_name || ' ' || e.last_name into v_by from users u join employees e on e.id = u.employee_id where u.id = new.last_edited_by;
  for m in select regexp_matches(new.content, '@\[[^\]]{1,80}\]\(user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)', 'g') loop
    v_user := m[1]::uuid;
    if v_user = new.last_edited_by then continue; end if;
    if okr_note_visible_to(v_user, new.session_id, new.visibility, new.author_id) then
      perform okr_notify(new.last_edited_by, array[v_user], 'SESSION_MENTION', 'okr_session', s.id, 'You were mentioned in ' || s.reference,
                         coalesce(v_by, 'Someone') || ' mentioned you in a note of the OKR session "' || left(s.title, 120) || '".', 'okrment:' || new.id || ':' || v_user);
    end if;
  end loop;
  return new;
exception when others then
  raise warning 'okr_notify_note_mentions failed: %', sqlerrm;    -- a notice problem never breaks saving a note
  return new;
end $$;

create trigger okr_session_notes_mentions after insert or update of content on okr_session_notes
  for each row execute function okr_notify_note_mentions();

-- Upload scanning (ADR-094): every scanned upload is recorded in the session timeline with the engine and verdict; a refused file is recorded too and never stored.
create or replace function record_okr_attachment_scan(p_actor uuid, p_session uuid, p_attachment uuid, p_file_name text, p_engine text, p_outcome text, p_detail text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform okr_get_session(p_actor, p_session);
  if p_outcome not in ('CLEAN', 'REJECTED') then raise exception 'VALIDATION_ERROR'; end if;
  perform okr_log(p_actor, p_session, 'ATTACHMENT', p_attachment, case when p_outcome = 'CLEAN' then 'SCANNED_CLEAN' else 'REJECTED_BY_SCAN' end,
                  jsonb_build_object('file_name', left(coalesce(p_file_name, ''), 255), 'engine', p_engine, 'detail', left(coalesce(p_detail, ''), 300)));
end $$;

select lock_down_function_grants();
