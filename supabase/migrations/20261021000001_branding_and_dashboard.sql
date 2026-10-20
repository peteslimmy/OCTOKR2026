-- Branding (name, short mark, colour, logo, favicon) and the dashboard analytics read model (ADR-074).

-- ---------------------------------------------------------------- branding
insert into permissions (code, description) values ('branding.manage', 'Change the application name, logo, favicon and colour');
insert into role_permissions (role_id, permission_id)
select r.id, p.id from (values ('SUPER_ADMIN','branding.manage'), ('ADMIN','branding.manage')) g(role_code, perm)
join roles r on r.code = g.role_code join permissions p on p.code = g.perm;

create table app_branding (
  id             boolean primary key default true check (id),
  app_name       text not null default '4CORE-OKR' check (char_length(btrim(app_name)) between 1 and 60),
  short_name     text not null default '4' check (char_length(btrim(short_name)) between 1 and 3),
  primary_color  text not null default '#7f1519' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_version    int not null default 0,
  favicon_version int not null default 0,
  updated_by     uuid references users(id),
  updated_at     timestamptz not null default app_now()
);
insert into app_branding default values;

-- The image bytes live apart from the settings so the settings stay small to read. Base64 text keeps the upload path simple and portable.
create table app_branding_assets (
  kind       text primary key check (kind in ('LOGO','FAVICON')),
  mime       text not null check (mime in ('image/png','image/jpeg','image/webp','image/x-icon','image/vnd.microsoft.icon')),
  data_b64   text not null check (char_length(data_b64) between 1 and 700000),
  updated_at timestamptz not null default app_now()
);

-- The name and logo are shown on the sign-in page, so both tables can be read without signing in. Only service-role functions write.
alter table app_branding enable row level security;
alter table app_branding_assets enable row level security;
grant select on app_branding, app_branding_assets to anon, authenticated;
create policy read_all on app_branding for select to anon, authenticated using (true);
create policy read_all on app_branding_assets for select to anon, authenticated using (true);

create or replace function set_branding(p_actor uuid, p_app_name text, p_short_name text, p_primary_color text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old app_branding;
begin
  perform require_permission(p_actor, 'branding.manage');
  if p_primary_color !~ '^#[0-9a-fA-F]{6}$' or char_length(btrim(p_app_name)) not between 1 and 60 or char_length(btrim(p_short_name)) not between 1 and 3 then
    raise exception 'VALIDATION_ERROR';
  end if;
  select * into v_old from app_branding;
  update app_branding set app_name = btrim(p_app_name), short_name = btrim(p_short_name), primary_color = lower(p_primary_color), updated_by = p_actor, updated_at = app_now() where id;
  perform write_audit(p_actor, 'BRANDING_CHANGED', 'app_branding', 'singleton',
    jsonb_build_object('appName', v_old.app_name, 'shortName', v_old.short_name, 'primaryColor', v_old.primary_color),
    jsonb_build_object('appName', btrim(p_app_name), 'shortName', btrim(p_short_name), 'primaryColor', lower(p_primary_color)));
end $$;

create or replace function set_branding_asset(p_actor uuid, p_kind text, p_mime text, p_data_b64 text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_version int;
begin
  perform require_permission(p_actor, 'branding.manage');
  if p_kind not in ('LOGO','FAVICON') then raise exception 'VALIDATION_ERROR'; end if;
  insert into app_branding_assets (kind, mime, data_b64) values (p_kind, p_mime, p_data_b64)
    on conflict (kind) do update set mime = excluded.mime, data_b64 = excluded.data_b64, updated_at = app_now();
  if p_kind = 'LOGO' then update app_branding set logo_version = logo_version + 1, updated_by = p_actor, updated_at = app_now() where id returning logo_version into v_version;
  else update app_branding set favicon_version = favicon_version + 1, updated_by = p_actor, updated_at = app_now() where id returning favicon_version into v_version; end if;
  perform write_audit(p_actor, 'BRANDING_ASSET_CHANGED', 'app_branding', lower(p_kind), null, jsonb_build_object('kind', p_kind, 'mime', p_mime, 'bytes', char_length(p_data_b64) * 3 / 4));
  return v_version;
end $$;

create or replace function clear_branding_asset(p_actor uuid, p_kind text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_permission(p_actor, 'branding.manage');
  if p_kind not in ('LOGO','FAVICON') then raise exception 'VALIDATION_ERROR'; end if;
  delete from app_branding_assets where kind = p_kind;
  if p_kind = 'LOGO' then update app_branding set logo_version = 0, updated_by = p_actor, updated_at = app_now() where id;
  else update app_branding set favicon_version = 0, updated_by = p_actor, updated_at = app_now() where id; end if;
  perform write_audit(p_actor, 'BRANDING_ASSET_REMOVED', 'app_branding', lower(p_kind), null, jsonb_build_object('kind', p_kind));
end $$;

-- ---------------------------------------------------------------- Business Units and Departments
-- A Department is a unit that does not file weekly reports (reports_weekly = false). Choosing the type when a unit is created avoids a
-- second, approval-gated change straight afterwards.
create or replace function create_business_unit(p_actor uuid, p_code text, p_name text, p_reports_weekly boolean default true) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_org uuid;
begin
  perform require_permission(p_actor, 'business_units.manage');
  select id into v_org from organisations limit 1;
  begin
    insert into business_units (organisation_id, code, name, reports_weekly) values (v_org, upper(btrim(p_code)), btrim(p_name), coalesce(p_reports_weekly, true)) returning id into v_id;
  exception when unique_violation then raise exception 'VALIDATION_ERROR' using detail = 'BU code already exists'; end;
  perform write_audit(p_actor, 'BU_CREATED', 'business_unit', v_id::text, null, jsonb_build_object('code', upper(btrim(p_code)), 'name', btrim(p_name), 'reportsWeekly', coalesce(p_reports_weekly, true)));
  return v_id;
end $$;
drop function if exists create_business_unit(uuid, text, text);

-- ---------------------------------------------------------------- dashboard analytics
-- One row per active unit per reporting week of the quarter: tasks, goals, score, compliance. The page folds these rows into totals,
-- trends and rankings, so every number on the dashboard comes from the same authoritative rows. SECURITY INVOKER: row-level security
-- limits each caller to the units they may see. Nothing here recalculates a score.
create or replace function read_dashboard_cells(p_quarter_id uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.week_start_at, t.business_unit), '[]'::jsonb) from (
    select b.id as business_unit_id, b.code as bu_code, b.name as business_unit, b.reports_weekly,
           w.id as reporting_week_id, w.week_number, w.week_year, w.week_start_at, w.reporting_state,
           r.id as weekly_report_id, coalesce(r.submission_status, 'NOT_SUBMITTED') as submission_status, r.submitted_at,
           (r.submitted_at is not null and r.submitted_at <= w.content_lock_at) as submitted_on_time,
           coalesce(tk.total, 0) as tasks_total, coalesce(tk.done, 0) as tasks_done, coalesce(tk.not_done, 0) as tasks_not_done, coalesce(tk.undefined_count, 0) as tasks_undefined,
           coalesce(gl.total, 0) as goals_total, coalesce(gl.done, 0) as goals_done,
           s.final_score, s.score_state, wc.status as compliance_status
    from business_units b
    cross join reporting_weeks w
    left join weekly_reports r on r.business_unit_id = b.id and r.reporting_week_id = w.id
    left join lateral (
      select count(*)::int as total, count(*) filter (where t.status = 'DONE')::int as done, count(*) filter (where t.status = 'NOT_DONE')::int as not_done,
             count(*) filter (where t.status = 'UNDEFINED')::int as undefined_count
      from tasks t join smart_goals g on g.id = t.smart_goal_id
      where g.weekly_report_id = r.id and t.deleted_at is null and g.deleted_at is null) tk on r.id is not null
    left join lateral (
      select count(*)::int as total, count(*) filter (where goal_is_done(g.id))::int as done
      from smart_goals g where g.weekly_report_id = r.id and g.deleted_at is null) gl on r.id is not null
    left join lateral (
      select x.final_score, x.score_state from weekly_score_snapshots x
      where x.business_unit_id = b.id and x.reporting_week_id = w.id order by x.version_number desc limit 1) s on true
    left join weekly_compliance wc on wc.business_unit_id = b.id and wc.reporting_week_id = w.id
    where b.status = 'ACTIVE' and w.quarter_id = p_quarter_id and auth_can_view_bu(b.id)) t
$$;

select lock_down_function_grants();
