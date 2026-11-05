-- A rejected fund request is never edited or reopened (it stays as the record of what was decided). Its requester can raise a revised request that points back to it,
-- saying what changed. The two are linked on screen, and each rejected request can have only one revision.
alter table disbursement_requests add column resubmits_request_id uuid references disbursement_requests(id), add column resubmit_note text;
create unique index disbursement_requests_one_revision on disbursement_requests (resubmits_request_id) where resubmits_request_id is not null;

create or replace function resubmit_disbursement_request(p_actor uuid, p_original uuid, p_amount numeric, p_purpose text, p_justification text, p_note text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o disbursement_requests; v_res jsonb; v_id uuid;
begin
  perform require_permission(p_actor, 'disbursement.create');
  if p_note is null or btrim(p_note) = '' then raise exception 'VALIDATION_ERROR' using detail = 'say what you changed or clarified since the rejection'; end if;
  select * into o from disbursement_requests where id = p_original for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.requested_by <> p_actor then raise exception 'PERMISSION_DENIED' using detail = 'only the person who raised a request can revise it'; end if;
  if o.status <> 'REJECTED' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'only a rejected request can be revised'; end if;
  select id into v_id from disbursement_requests where resubmits_request_id = p_original;
  if found then
    -- the same click sent twice returns the same revision; a different revision is refused
    if exists (select 1 from disbursement_requests where id = v_id and idempotency_key = p_idempotency_key) then return jsonb_build_object('request_id', v_id, 'replayed', true); end if;
    raise exception 'VALIDATION_ERROR' using detail = 'this request has already been revised';
  end if;
  v_res := create_disbursement_request(p_actor, p_amount, p_purpose, p_justification, p_idempotency_key);
  v_id := (v_res->>'request_id')::uuid;
  if not (v_res->>'replayed')::boolean then
    update disbursement_requests set resubmits_request_id = p_original, resubmit_note = btrim(p_note) where id = v_id;
    perform write_audit(p_actor, 'DISBURSEMENT_RESUBMITTED', 'disbursement_request', v_id::text, null, jsonb_build_object('revises', p_original, 'amount', p_amount), btrim(p_note));
  end if;
  return v_res;
end $$;

do $$
declare v_def text; a text := '''disbursement'', (select';
begin
  v_def := pg_get_functiondef('read_disbursement_requests()'::regprocedure);
  if position(a in v_def) = 0 then raise exception 'read_disbursement_requests changed'; end if;
  execute replace(v_def, a, '''resubmits'', r.resubmits_request_id, ''resubmit_note'', r.resubmit_note, ''resubmitted_as'', (select c.id from disbursement_requests c where c.resubmits_request_id = r.id), ' || a);
end $$;
select lock_down_function_grants();
-- lock_down_function_grants() withdraws execute from helpers it does not know; person_name() is called by the read_* functions as the caller
grant execute on function person_name(uuid) to authenticated;
