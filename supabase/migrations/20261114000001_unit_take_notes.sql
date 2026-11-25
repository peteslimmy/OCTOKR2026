-- ADR-133: Take Notes is a unit's (or department's) OWN notes from a weekly session. ADR-113 made the Note Taker's notes organisation-wide and
-- dropped the three-argument function in 20261106000009; the two-argument function stays for the official Session Notes, and this adds the per-unit
-- overload back, unchanged from 20261106000008. Who may read a unit's page is decided by okr_session_visible_to / okr_note_visible_to (already in place).
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
