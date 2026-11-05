-- 1. Payment methods are a managed list. Each has a unique three-character code, and every payment reference is made by the application:
--    <CODE>-<YEAR>-<six-digit number>, for example SAL-2026-000042. The person recording a payment chooses the method and never types a reference.
--    A method can be marked "deducted from salary", which settles the violation as DEDUCTION_RECORDED instead of PAID.
-- 2. The quote of the week names its speaker from the list of people: the name and the unit are taken from that person, not typed.

create table payment_methods (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[A-Z0-9]{3}$'),
  name         text not null check (btrim(name) <> '' and char_length(name) <= 80),
  is_deduction boolean not null default false,
  active       boolean not null default true,
  created_by   uuid references users(id),
  created_at   timestamptz not null default app_now()
);
alter table payment_methods enable row level security;
grant select on payment_methods to authenticated;
create policy read_staff on payment_methods for select to authenticated
  using ((select auth_has_any(array['violation.create', 'violation.edit', 'violation.payment.record', 'finance.fund.view', 'finance.ledger.view'])));

insert into payment_methods (code, name, is_deduction) values ('PAY', 'Payment', false), ('SAL', 'Salary deduction', true), ('POC', 'Paid out of pocket', false);

-- earlier payments keep their method as it was written; new ones carry the method code
alter table violation_payments drop constraint violation_payments_method_check;
alter table violation_payments add constraint violation_payments_method_check check (method ~ '^[A-Z0-9_]{3,20}$');

create table payment_reference_counters (
  method_code text not null,
  year        int  not null,
  last_value  int  not null default 0,
  primary key (method_code, year)
);
alter table payment_reference_counters enable row level security;

create or replace function next_payment_reference(p_code text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_year int := extract(year from app_now() at time zone 'Africa/Lagos')::int; v_n int; v_ref text;
begin
  loop
    insert into payment_reference_counters (method_code, year, last_value) values (p_code, v_year, 1)
    on conflict (method_code, year) do update set last_value = payment_reference_counters.last_value + 1 returning last_value into v_n;
    v_ref := p_code || '-' || v_year || '-' || lpad(v_n::text, 6, '0');
    exit when not exists (select 1 from violation_payments where reference = v_ref);
  end loop;
  return v_ref;
end $$;

create or replace function save_payment_method(p_actor uuid, p_id uuid, p_code text, p_name text, p_is_deduction boolean, p_active boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := p_id; v_code text := upper(btrim(coalesce(p_code, ''))); v_name text := btrim(coalesce(p_name, '')); m payment_methods;
begin
  perform require_permission(p_actor, 'violation.edit');
  if v_name = '' or char_length(v_name) > 80 then raise exception 'VALIDATION_ERROR' using detail = 'a payment method needs a name of up to 80 characters'; end if;
  if v_id is null then
    if v_code !~ '^[A-Z0-9]{3}$' then raise exception 'VALIDATION_ERROR' using detail = 'the code is exactly three letters or digits'; end if;
    insert into payment_methods (code, name, is_deduction, active, created_by) values (v_code, v_name, coalesce(p_is_deduction, false), coalesce(p_active, true), p_actor) returning id into v_id;
  else
    select * into m from payment_methods where id = v_id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    -- the code never changes: it is the start of every reference already issued with it
    if coalesce(p_active, m.active) = false and m.active and not exists (select 1 from payment_methods where active and id <> v_id) then
      raise exception 'VALIDATION_ERROR' using detail = 'at least one payment method must stay in use'; end if;
    update payment_methods set name = v_name, is_deduction = coalesce(p_is_deduction, is_deduction), active = coalesce(p_active, active) where id = v_id;
  end if;
  perform write_audit(p_actor, case when p_id is null then 'PAYMENT_METHOD_ADDED' else 'PAYMENT_METHOD_CHANGED' end, 'payment_method', v_id::text, case when m.id is null then null else jsonb_build_object('name', m.name, 'active', m.active, 'is_deduction', m.is_deduction) end,
    jsonb_build_object('name', v_name, 'active', p_active, 'is_deduction', p_is_deduction, 'code', coalesce(v_code, m.code)), null);
  return v_id;
exception when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'that code is already used by another payment method';
end $$;

-- record_violation_payment: the method is a code from the list (the two old names still work), and the reference is generated
do $$
declare v_def text; r record;
begin
  v_def := pg_get_functiondef('record_violation_payment(uuid,uuid,text,text,date,text)'::regprocedure);
  for r in select * from (values
    ('declare v violations;', 'declare pm payment_methods; v_code text; v_ref text; v violations;'),
    ('if p_reference is null or btrim(p_reference) = '''' then raise exception ''VALIDATION_ERROR'' using detail = ''payment reference required''; end if;', ''),
    ('if p_method not in (''PAYMENT'',''SALARY_DEDUCTION'') then raise exception ''VALIDATION_ERROR'' using detail = ''invalid method''; end if;',
     'v_code := case upper(btrim(coalesce(p_method, ''''))) when ''PAYMENT'' then ''PAY'' when ''SALARY_DEDUCTION'' then ''SAL'' else upper(btrim(coalesce(p_method, ''''))) end; select * into pm from payment_methods where code = v_code and active; if not found then raise exception ''VALIDATION_ERROR'' using detail = ''choose one of the payment methods in use''; end if;'),
    ('if v.status <> ''OPEN'' then raise exception ''VIOLATION_ALREADY_SETTLED''; end if;', 'if v.status <> ''OPEN'' then raise exception ''VIOLATION_ALREADY_SETTLED''; end if; v_ref := coalesce(nullif(btrim(p_reference), ''''), next_payment_reference(v_code));'),
    ('values (p_violation, p_method, v.fine_amount, btrim(p_reference), p_paid_at, p_actor, p_idempotency_key)', 'values (p_violation, v_code, v.fine_amount, v_ref, p_paid_at, p_actor, p_idempotency_key)'),
    ('case p_method when ''PAYMENT'' then ''PAID'' else ''DEDUCTION_RECORDED'' end', 'case when pm.is_deduction then ''DEDUCTION_RECORDED'' else ''PAID'' end'),
    ('''reference'', btrim(p_reference)', '''reference'', v_ref, ''method'', v_code'),
    ('''amount'', v.fine_amount, ''replayed'', false);', '''amount'', v.fine_amount, ''reference'', v_ref, ''method'', v_code, ''replayed'', false);')
  ) as t(a, b) loop
    if position(r.a in v_def) = 0 then raise exception 'record_violation_payment no longer contains: %', left(r.a, 60); end if;
    v_def := replace(v_def, r.a, r.b);
  end loop;
  execute v_def;
end $$;

-- the quote's speaker comes from the list of people: name and unit are read from the person
create or replace function record_weekly_quote_for(p_actor uuid, p_week_id uuid, p_employee uuid, p_quote text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare e employees;
begin
  perform require_permission(p_actor, 'quote.record');
  select * into e from employees where id = p_employee and employment_status = 'ACTIVE';
  if not found then raise exception 'NOT_FOUND'; end if;
  return record_weekly_quote(p_actor, p_week_id, e.business_unit_id, btrim(e.first_name || ' ' || e.last_name), p_quote);
end $$;

select lock_down_function_grants();
