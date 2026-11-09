-- A short, stable, readable code for every Business Unit goal: BG-1, BG-2, ... numbered per unit and quarter in the order the goals were created (ADR-120).
-- The weekly-goals upload uses it (the "BU goal ID" column) instead of the goal's full title. A code never changes and is never reused, even when its goal is retired.

alter table bu_goals add column if not exists code text;

-- existing goals: numbered in the order they were created
update bu_goals g set code = 'BG-' || n.rn
  from (select id, row_number() over (partition by business_unit_id, quarter_id order by position, created_at, id) as rn from bu_goals) n
 where n.id = g.id and g.code is null;

alter table bu_goals alter column code set not null;
create unique index if not exists bu_goals_code_idx on bu_goals (business_unit_id, quarter_id, code);

create or replace function bu_goal_assign_code() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare n int;
begin
  -- two goals added at once in the same unit and quarter must not take the same number
  perform pg_advisory_xact_lock(hashtextextended('bu_goal_code:' || new.business_unit_id::text || ':' || new.quarter_id::text, 0));
  select coalesce(max(substring(code from 4)::int), 0) + 1 into n from bu_goals where business_unit_id = new.business_unit_id and quarter_id = new.quarter_id;
  new.code := 'BG-' || n;
  return new;
end $$;
drop trigger if exists bu_goals_assign_code on bu_goals;
create trigger bu_goals_assign_code before insert on bu_goals for each row execute function bu_goal_assign_code();

create or replace function bu_goal_keep_code() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.code is distinct from old.code then raise exception 'VALIDATION_ERROR' using detail = 'a goal code never changes'; end if;
  return new;
end $$;
drop trigger if exists bu_goals_keep_code on bu_goals;
create trigger bu_goals_keep_code before update on bu_goals for each row execute function bu_goal_keep_code();

select lock_down_function_grants();
