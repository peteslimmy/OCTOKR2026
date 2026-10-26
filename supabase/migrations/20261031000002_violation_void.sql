-- A violation that is contested and won is VOID: no fine is owed and nothing is credited to the violation fund.
-- The fund only ever receives money through record_violation_payment, which needs status OPEN, so a void violation can never reach it.
-- A violation that was already paid cannot be voided directly: its payment is reversed in the ledger first (which reopens it), then it is voided.

alter table violations
  add column voided_at  timestamptz,
  add column voided_by  uuid references users(id),
  add column void_reason text;

alter table violations drop constraint violations_status_check;
alter table violations add constraint violations_status_check check (status in ('OPEN','PAID','DEDUCTION_RECORDED','VOID'));
alter table violations add constraint violations_void_complete check (
  (status = 'VOID') = (voided_at is not null and voided_by is not null and void_reason is not null));

insert into permissions (code, description) values ('violation.void', 'Void a violation that was contested and won (no fine is owed or credited)');
insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values ('HR','violation.void'),('ADMIN','violation.void'),('SUPER_ADMIN','violation.void')) as g(role_code, perm)
join roles r on r.code = g.role_code join permissions p on p.code = g.perm;

create or replace function void_violation(p_actor uuid, p_violation uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v violations; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform require_permission(p_actor, 'violation.void');
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  if char_length(v_reason) > 2000 then raise exception 'VALIDATION_ERROR' using detail = 'the reason is limited to 2000 characters'; end if;
  select * into v from violations where id = p_violation for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v.status = 'VOID' then raise exception 'INVALID_STATE_TRANSITION' using detail = 'this violation is already void'; end if;
  if v.status <> 'OPEN' then raise exception 'VIOLATION_ALREADY_SETTLED' using detail = 'a paid violation must have its payment reversed in the ledger before it can be voided'; end if;
  -- two sets of eyes: whoever raised the violation cannot also clear it
  if v.created_by = p_actor then raise exception 'VIOLATION_SELF_VOID' using detail = 'the person who raised a violation cannot void it'; end if;
  update violations set status = 'VOID', voided_at = app_now(), voided_by = p_actor, void_reason = v_reason, updated_at = app_now() where id = p_violation;
  perform write_audit(p_actor, 'VIOLATION_VOIDED', 'violation', p_violation::text, jsonb_build_object('status', 'OPEN', 'fine_amount', v.fine_amount),
    jsonb_build_object('status', 'VOID'), v_reason, v.business_unit_id);
end $$;

-- the violation list also carries who the person is (unit, email) and, for a void violation, why and when
do $$
declare v_def text; v_old text := '''override_reason'', v.fine_override_reason,';
begin
  v_def := pg_get_functiondef('read_violations()'::regprocedure);
  if position(v_old in v_def) = 0 then raise exception 'read_violations no longer contains the expected line'; end if;
  execute replace(v_def, v_old, v_old || ' ''employee_email'', e.email, ''void_reason'', v.void_reason, ''voided_at'', v.voided_at,');
end $$;

-- the Super Admin can ask for funds too; approval and release stay with Finance and nobody decides their own request
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p where r.code = 'SUPER_ADMIN' and p.code = 'disbursement.create';

select lock_down_function_grants();
