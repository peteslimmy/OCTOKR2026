-- A unit is a Business Unit or a Department, independently of whether it files a weekly report (a Department such as HR or IT may report; a
-- Business Unit normally does). Until now the two were conflated: "reports weekly" meant Business Unit.
alter table business_units add column unit_type text check (unit_type in ('BUSINESS_UNIT','DEPARTMENT'));
update business_units set unit_type = case when reports_weekly then 'BUSINESS_UNIT' else 'DEPARTMENT' end;

create or replace function business_unit_default_type() returns trigger
language plpgsql as $$
begin
  new.unit_type := coalesce(new.unit_type, case when new.reports_weekly then 'BUSINESS_UNIT' else 'DEPARTMENT' end);
  return new;
end $$;
create trigger business_units_default_type before insert on business_units for each row execute function business_unit_default_type();
alter table business_units alter column unit_type set not null;

select lock_down_function_grants();
