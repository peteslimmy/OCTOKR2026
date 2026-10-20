-- A refused attempt is evidence too (acceptance criterion AC-OP-9; docs/15-AUDIT-CONTROLS). When a signed-in person is turned away from an
-- action they were not allowed to take, the refusal is written to the append-only audit log. The record names the person, the route (with
-- identifiers removed) and the reason code, never the request body. Repeats by the same person on the same route within a minute are
-- collapsed, so probing cannot be used to flood the log.

create or replace function record_access_denied(p_actor uuid, p_method text, p_route text, p_code text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_route text := left(coalesce(p_route, ''), 200);
begin
  if p_actor is null or v_route = '' then return false; end if;
  if exists (select 1 from audit_logs where actor_user_id = p_actor and action = 'ACCESS_DENIED' and entity_id = v_route
               and occurred_at > app_now() - interval '1 minute') then
    return false;
  end if;
  perform write_audit(p_actor, 'ACCESS_DENIED', 'route', v_route, null,
    jsonb_build_object('method', left(coalesce(p_method, ''), 10), 'code', left(coalesce(p_code, ''), 40)), null, null, 'DENIED');
  return true;
end $$;

select lock_down_function_grants();
