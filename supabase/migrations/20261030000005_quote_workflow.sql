-- Quote workflow (gap plan phase F, ADR-084): draft -> submitted -> approved -> published -> archived.
-- The table already held one quote per week; the earlier routes called functions that never existed and the table could not change status.

insert into permissions (code, description) values
  ('quote.approve', 'Approve, publish and archive the weekly quote');
insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values ('ADMIN','quote.approve'),('DIRECTOR','quote.approve'),('SUPER_ADMIN','quote.approve')) as g(role_code, perm)
join roles r on r.code = g.role_code join permissions p on p.code = g.perm;

alter table weekly_quotes
  add column submitted_by uuid references users(id),
  add column submitted_at timestamptz,
  add column approved_by  uuid references users(id),
  add column approved_at  timestamptz,
  add column published_at timestamptz,
  add column archived_at  timestamptz;

-- the words and the author never change; only the workflow moves, one legal step at a time
drop trigger weekly_quotes_immutable on weekly_quotes;
create or replace function guard_weekly_quote() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD' using detail = 'quotes are never deleted'; end if;
  if (new.id, new.reporting_week_id, new.business_unit_id, new.speaker_name, new.quote, new.recorded_by, new.created_at)
     is distinct from (old.id, old.reporting_week_id, old.business_unit_id, old.speaker_name, old.quote, old.recorded_by, old.created_at) then
    raise exception 'IMMUTABLE_RECORD' using detail = 'a recorded quote cannot be edited';
  end if;
  if new.status is distinct from old.status
     and (old.status, new.status) not in (('draft','submitted'),('submitted','approved'),('approved','published'),('published','archived')) then
    raise exception 'INVALID_STATE_TRANSITION' using detail = format('%s to %s is not allowed', old.status, new.status);
  end if;
  return new;
end $$;
create trigger weekly_quotes_guard before update or delete on weekly_quotes for each row execute function guard_weekly_quote();

create or replace function quote_step(p_actor uuid, p_quote_id uuid, p_permission text, p_from text, p_to text) returns weekly_quotes
language plpgsql security definer set search_path = public, pg_temp as $$
declare q weekly_quotes;
begin
  perform require_permission(p_actor, p_permission);
  select * into q from weekly_quotes where id = p_quote_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if q.status <> p_from then raise exception 'INVALID_STATE_TRANSITION' using detail = format('the quote is %s, not %s', q.status, p_from); end if;
  return q;
end $$;

create or replace function submit_quote(p_actor uuid, p_quote_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare q weekly_quotes;
begin
  q := quote_step(p_actor, p_quote_id, 'quote.record', 'draft', 'submitted');
  update weekly_quotes set status = 'submitted', submitted_by = p_actor, submitted_at = app_now() where id = q.id;
  perform write_audit(p_actor, 'QUOTE_SUBMITTED', 'weekly_quote', q.id::text, jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'submitted'), null, q.business_unit_id);
  perform notify_users(users_with_permission('quote.approve'), 'QUOTE_SUBMITTED', 'weekly_quote', q.id::text, 'Weekly quote awaiting approval',
    'A weekly quote was submitted and needs approval.', 'quote-submitted:' || q.id::text);
end $$;

create or replace function approve_quote(p_actor uuid, p_quote_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare q weekly_quotes;
begin
  q := quote_step(p_actor, p_quote_id, 'quote.approve', 'submitted', 'approved');
  if p_actor in (q.recorded_by, q.submitted_by) then raise exception 'QUOTE_SELF_APPROVAL' using detail = 'the person who recorded or submitted a quote cannot approve it'; end if;
  update weekly_quotes set status = 'approved', approved_by = p_actor, approved_at = app_now() where id = q.id;
  perform write_audit(p_actor, 'QUOTE_APPROVED', 'weekly_quote', q.id::text, jsonb_build_object('status', 'submitted'), jsonb_build_object('status', 'approved'), null, q.business_unit_id);
end $$;

create or replace function publish_quote(p_actor uuid, p_quote_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare q weekly_quotes;
begin
  q := quote_step(p_actor, p_quote_id, 'quote.approve', 'approved', 'published');
  update weekly_quotes set status = 'published', published_at = app_now() where id = q.id;
  perform write_audit(p_actor, 'QUOTE_PUBLISHED', 'weekly_quote', q.id::text, jsonb_build_object('status', 'approved'), jsonb_build_object('status', 'published'), null, q.business_unit_id);
end $$;

create or replace function archive_quote(p_actor uuid, p_quote_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare q weekly_quotes;
begin
  q := quote_step(p_actor, p_quote_id, 'quote.approve', 'published', 'archived');
  update weekly_quotes set status = 'archived', archived_at = app_now() where id = q.id;
  perform write_audit(p_actor, 'QUOTE_ARCHIVED', 'weekly_quote', q.id::text, jsonb_build_object('status', 'published'), jsonb_build_object('status', 'archived'), null, q.business_unit_id);
end $$;

-- the dashboard banner: anyone signed in sees the published quote of a week, and nothing else about quotes
create or replace function read_published_quote(p_week_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', q.id, 'speaker_name', q.speaker_name, 'quote', q.quote, 'business_unit', b.name, 'published_at', q.published_at)
  from weekly_quotes q join business_units b on b.id = q.business_unit_id
  where q.reporting_week_id = p_week_id and q.status = 'published' and auth.uid() is not null;
$$;

select lock_down_function_grants();
