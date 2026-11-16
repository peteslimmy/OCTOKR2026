-- Fund requests are treated first in, first out (ADR-125; owner request: "older request should be treated first before the newer ones; only
-- Super Admin and Admin can skip the queue, with a recorded reason").
-- "Treating" a request means starting its review, approving it or rejecting it. While an older request is still SUBMITTED or UNDER_REVIEW,
-- a newer one cannot be treated (DISBURSEMENT_FIFO). A request that is withdrawn, rejected or approved leaves the queue; a resubmitted request is
-- new and goes to the back. An Admin or Super Admin can treat one request out of order after recording why (skip_disbursement_queue), which is
-- audited. Releasing cash for an approved request is unchanged.

insert into permissions (code, description, protected, reserved, module, risk) values
  ('disbursement.skip_queue', 'Treat a fund request out of order, with a recorded reason', true, false, 'Finance', 'critical')
on conflict (code) do nothing;
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p where r.code in ('SUPER_ADMIN', 'ADMIN') and p.code = 'disbursement.skip_queue'
on conflict do nothing;
insert into audit_action_rules (pattern, category, severity, priority) values ('DISBURSEMENT_QUEUE_SKIPPED', 'FINANCE', 'HIGH', 900)
on conflict (pattern) do nothing;

create table if not exists disbursement_queue_waivers (
  request_id uuid primary key references disbursement_requests(id) on delete restrict,
  reason     text not null check (btrim(reason) <> '' and char_length(reason) <= 1000),
  waived_by  uuid not null references users(id),
  blocked_by uuid references disbursement_requests(id),
  created_at timestamptz not null default app_now()
);
alter table disbursement_queue_waivers enable row level security;
create trigger disbursement_queue_waivers_immutable before update or delete on disbursement_queue_waivers for each row execute function forbid_mutation();

-- the oldest request still waiting that is older than this one (null: this request is next in line)
create or replace function disbursement_queue_blocker(p_request uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select o.id from disbursement_requests o, disbursement_requests r
   where r.id = p_request and o.status in ('SUBMITTED', 'UNDER_REVIEW') and (o.created_at, o.id) < (r.created_at, r.id)
   order by o.created_at, o.id limit 1;
$$;

create or replace function disbursement_fifo_check(p_request uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_block uuid;
begin
  v_block := disbursement_queue_blocker(p_request);
  if v_block is not null and not exists (select 1 from disbursement_queue_waivers w where w.request_id = p_request) then
    raise exception 'DISBURSEMENT_FIFO' using detail = 'an older request is still waiting and must be treated first';
  end if;
end $$;

create or replace function skip_disbursement_queue(p_actor uuid, p_request_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r disbursement_requests; v_block uuid; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform require_permission(p_actor, 'disbursement.skip_queue');
  if v_reason is null then raise exception 'VALIDATION_ERROR' using detail = 'a reason is required to treat a request out of order'; end if;
  select * into r from disbursement_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.status not in ('SUBMITTED', 'UNDER_REVIEW') then raise exception 'INVALID_STATE_TRANSITION' using detail = 'request is ' || r.status; end if;
  v_block := disbursement_queue_blocker(p_request_id);
  if v_block is null then return jsonb_build_object('skipped', false, 'reason', 'this request is already next in line'); end if;
  insert into disbursement_queue_waivers (request_id, reason, waived_by, blocked_by) values (p_request_id, v_reason, p_actor, v_block) on conflict do nothing;
  perform write_audit(p_actor, 'DISBURSEMENT_QUEUE_SKIPPED', 'disbursement_request', p_request_id::text, jsonb_build_object('older_request', v_block),
    jsonb_build_object('amount', r.amount, 'purpose', r.purpose), v_reason);
  return jsonb_build_object('skipped', true, 'older_request', v_block);
end $$;

-- start review, approve and reject: refuse out of order
do $$
declare v_def text;
  a text := $a$if r.status = 'UNDER_REVIEW' then return; end if;$a$;
begin
  v_def := pg_get_functiondef('start_disbursement_review(uuid,uuid)'::regprocedure);
  if position('disbursement_fifo_check' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'start_disbursement_review changed'; end if;
  execute replace(v_def, a, a || ' perform disbursement_fifo_check(p_request_id);');
end $$;

do $$
declare v_def text;
  a text := $a$if r.status not in ('SUBMITTED','UNDER_REVIEW') then raise exception 'INVALID_STATE_TRANSITION' using detail = 'request is ' || r.status; end if;$a$;
begin
  v_def := pg_get_functiondef('decide_disbursement_request(uuid,uuid,boolean,text,text)'::regprocedure);
  if position('disbursement_fifo_check' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'decide_disbursement_request changed'; end if;
  execute replace(v_def, a, a || ' perform disbursement_fifo_check(p_request_id);');
end $$;

-- the list runs as the signed-in person, who cannot read the waiver table: a small definer helper answers "was this request waived", and is added to the
-- grant allowlist the same way earlier migrations extend it (never by restating it)
create or replace function disbursement_waived(p_request uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from disbursement_queue_waivers w where w.request_id = p_request);
$$;
do $$
declare v_def text; a text := '''auth_has_any'',''attendance_effective_status''';
begin
  v_def := pg_get_functiondef('lock_down_function_grants()'::regprocedure);
  if position('disbursement_waived' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'lock_down_function_grants changed'; end if;
  execute replace(v_def, a, '''disbursement_waived'',' || a);
end $$;

-- the list: waiting requests first, oldest first (the order they will be treated in); everything else newest first; each says whether it is next in line
do $$
declare v_def text;
  a text := $a$) order by r.created_at desc)$a$;
  b text := $b$, 'in_order', (not exists (select 1 from disbursement_requests o where o.status in ('SUBMITTED', 'UNDER_REVIEW') and (o.created_at, o.id) < (r.created_at, r.id)) or disbursement_waived(r.id))
  ) order by (r.status in ('SUBMITTED', 'UNDER_REVIEW')) desc, case when r.status in ('SUBMITTED', 'UNDER_REVIEW') then r.created_at end asc, r.created_at desc)$b$;
begin
  v_def := pg_get_functiondef('read_disbursement_requests()'::regprocedure);
  if position('in_order' in v_def) > 0 then return; end if;
  if position(a in v_def) = 0 then raise exception 'read_disbursement_requests changed'; end if;
  execute replace(v_def, a, b);
end $$;

select lock_down_function_grants();
