-- The person who raised a fund request can withdraw it while it is still waiting for a decision. A withdrawn request stays on record, is not rejected, and commits no money.
alter table disbursement_requests drop constraint disbursement_requests_status_check;
alter table disbursement_requests add constraint disbursement_requests_status_check check (status in ('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','DISBURSED','WITHDRAWN'));

do $$
declare v_def text; a text := 'or (old.status = ''APPROVED''     and new.status = ''DISBURSED''))';
begin
  v_def := pg_get_functiondef('guard_disbursement_request()'::regprocedure);
  if position(a in v_def) = 0 then raise exception 'guard_disbursement_request changed'; end if;
  execute replace(v_def, a, 'or (old.status in (''SUBMITTED'',''UNDER_REVIEW'') and new.status = ''WITHDRAWN'') ' || a);
end $$;

create or replace function withdraw_disbursement_request(p_actor uuid, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r disbursement_requests;
begin
  perform require_permission(p_actor, 'disbursement.create');
  select * into r from disbursement_requests where id = p_request for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.requested_by <> p_actor then raise exception 'PERMISSION_DENIED' using detail = 'only the person who raised a request can withdraw it'; end if;
  if r.status not in ('SUBMITTED','UNDER_REVIEW') then raise exception 'INVALID_STATE_TRANSITION' using detail = r.status || ' -> WITHDRAWN'; end if;
  update disbursement_requests set status = 'WITHDRAWN', updated_at = app_now() where id = p_request;
  perform write_audit(p_actor, 'DISBURSEMENT_WITHDRAWN', 'disbursement_request', p_request::text, jsonb_build_object('status', r.status), jsonb_build_object('status', 'WITHDRAWN'), null);
  return jsonb_build_object('request_id', p_request, 'status', 'WITHDRAWN');
end $$;
select lock_down_function_grants();
