-- Owner decision (ADR-112, extended 2026-11-06): there is no limit to what the Super Admin can do or see in OKR session notes.
-- Removed for the Super Admin only: (1) the rule that a CONFIDENTIAL note is readable only by its author and the facilitator; (2) the rule that the person who completed an action
-- cannot verify it. Not changed, because they keep the records trustworthy rather than limit anyone's access: every act is still audited, history, versions, finalised minutes and the
-- session timeline stay immutable, and request keys and version checks still apply.

create or replace function okr_note_visible_to(p_actor uuid, p_session uuid, p_visibility text, p_author uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select okr_session_visible_to(p_actor, p_session) and (
    p_visibility = 'SHARED' or p_author = p_actor
    or is_super_admin(p_actor)
    or exists (select 1 from okr_sessions s where s.id = p_session and s.facilitator_id = p_actor)
    or (p_visibility = 'MANAGEMENT' and actor_has_permission(p_actor, 'session_notes.view_all')));
$$;

do $$
declare v_def text; a text := 'if a.completed_by = p_actor then';
begin
  v_def := pg_get_functiondef('verify_okr_action(uuid,uuid,text,text,integer)'::regprocedure);
  if position('is_super_admin' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'verify_okr_action no longer contains the expected line'; end if;
  execute replace(v_def, a, 'if a.completed_by = p_actor and not is_super_admin(p_actor) then');
end $$;

select lock_down_function_grants();
