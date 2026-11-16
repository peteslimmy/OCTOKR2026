-- Session notes: the general note is for everybody, each unit's notes stay private to the unit (ADR-126; owner decisions).
--   * The Note Taker's weekly general note (the organisation-wide WEEKLY_OKR_REVIEW session, no unit) can be read by every signed-in person, through
--     read_general_session_notes(): shared notes only, no unit's own session, nothing that is not shared.
--   * A unit's own sessions and notes are already limited to people of that unit, the session's participants and holders of session_notes.view_all
--     (okr_session_visible_to / okr_note_visible_to, unchanged). Who holds view_all is now: Super Admin, Admin, Executive, Director (and the Note Taker,
--     who keeps the organisation-wide notes). The Presenter no longer does.

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p where r.code = 'ADMIN' and p.code in ('session_notes.view', 'session_notes.view_all')
on conflict do nothing;

create or replace function read_general_session_notes(p_limit int default 20) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (select 1 from users u where u.id = auth.uid() and u.status = 'ACTIVE') then raise exception 'PERMISSION_DENIED'; end if;
  return coalesce((select jsonb_agg(x order by x->>'session_date' desc, x->>'created_at' desc) from (
    select jsonb_build_object('session_id', s.id, 'title', s.title, 'session_date', s.session_date, 'status', s.status, 'created_at', s.created_at,
             'week_number', rw.week_number, 'week_year', rw.week_year, 'note_id', n.id, 'content', n.content, 'updated_at', n.updated_at,
             'author', (select e.first_name || ' ' || e.last_name from users u2 join employees e on e.id = u2.employee_id where u2.id = n.author_id)) as x
      from okr_sessions s
      join okr_session_types t on t.id = s.session_type_id and t.code = 'WEEKLY_OKR_REVIEW'
      left join reporting_weeks rw on rw.id = s.reporting_week_id
      join lateral (select * from okr_session_notes z where z.session_id = s.id and z.status = 'ACTIVE' and z.visibility = 'SHARED'
                     order by (z.title = 'Session notes') desc, z.created_at limit 1) n on true
     where s.business_unit_id is null and s.status in ('IN_PROGRESS', 'COMPLETED')
     order by s.session_date desc, s.created_at desc limit greatest(1, least(coalesce(p_limit, 20), 100))) q), '[]'::jsonb);
end $$;

select lock_down_function_grants();
