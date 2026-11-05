-- 1. The Super Admin holds every permission that exists. Self-approval stays blocked inside the functions themselves
--    (DISBURSEMENT_SELF_APPROVAL, ATTENDANCE_AMENDMENT_SELF_APPROVAL), so nobody can decide their own request.
-- 2. Fund-request purposes are a managed list: the Super Admin adds or retires them, requesters pick one.

insert into permissions (code, description) values ('finance.purpose.manage', 'Add, rename or retire the purposes offered on fund requests')
on conflict (code) do nothing;

create table disbursement_purposes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> '' and char_length(name) <= 100),
  active     boolean not null default true,
  created_at timestamptz not null default app_now()
);
create unique index disbursement_purposes_name_idx on disbursement_purposes (lower(btrim(name)));
alter table disbursement_purposes enable row level security;
grant select on disbursement_purposes to authenticated;
create policy read_all on disbursement_purposes for select to authenticated using (true);

insert into disbursement_purposes (name) values ('OKR Refreshment'), ('Data'), ('Others');

create or replace function save_disbursement_purpose(p_actor uuid, p_id uuid, p_name text, p_active boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := p_id; v_name text := btrim(coalesce(p_name, ''));
begin
  perform require_permission(p_actor, 'finance.purpose.manage');
  if v_name = '' or char_length(v_name) > 100 then raise exception 'VALIDATION_ERROR' using detail = 'a purpose needs a name of up to 100 characters'; end if;
  if v_id is null then
    insert into disbursement_purposes (name, active) values (v_name, coalesce(p_active, true)) returning id into v_id;
  else
    update disbursement_purposes set name = v_name, active = coalesce(p_active, active) where id = v_id;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  perform write_audit(p_actor, 'DISBURSEMENT_PURPOSE_SAVED', 'disbursement_purpose', v_id::text, null, jsonb_build_object('name', v_name, 'active', p_active), null, null);
  return v_id;
exception when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'that purpose already exists';
end $$;

-- a request must name one of the active purposes
create or replace function enforce_disbursement_purpose() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from disbursement_purposes where active and lower(btrim(name)) = lower(btrim(new.purpose))) then
    raise exception 'VALIDATION_ERROR' using detail = 'choose one of the listed purposes';
  end if;
  return new;
end $$;
create trigger disbursement_purpose_check before insert on disbursement_requests for each row execute function enforce_disbursement_purpose();

-- Super Admin: every permission, now and as it stands today
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r cross join permissions p where r.code = 'SUPER_ADMIN'
on conflict do nothing;

select lock_down_function_grants();
