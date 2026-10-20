-- Editable landing page and sign-in screens (ADR-076). Same permission as branding: branding.manage.
-- The configuration is plain data (validated by the application before it is sent); the images are stored as base64 text, raster types only.

create table site_content (
  id         boolean primary key default true check (id),
  landing    jsonb not null default '{}'::jsonb check (jsonb_typeof(landing) = 'object' and pg_column_size(landing) < 90000),
  login      jsonb not null default '{}'::jsonb check (jsonb_typeof(login) = 'object' and pg_column_size(login) < 40000),
  version    int not null default 0,
  updated_by uuid references users(id),
  updated_at timestamptz not null default app_now()
);
insert into site_content default values;

create table site_images (
  slot       text primary key check (slot ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  mime       text not null check (mime in ('image/png','image/jpeg','image/webp')),
  data_b64   text not null check (char_length(data_b64) between 1 and 2800000),
  version    int not null default 1,
  updated_at timestamptz not null default app_now()
);

-- the landing page and sign-in page are public, so these are readable without signing in; only service-role functions write
alter table site_content enable row level security;
alter table site_images enable row level security;
grant select on site_content, site_images to anon, authenticated;
create policy read_all on site_content for select to anon, authenticated using (true);
create policy read_all on site_images for select to anon, authenticated using (true);

create or replace function set_site_content(p_actor uuid, p_landing jsonb, p_login jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old site_content; v_version int;
begin
  perform require_permission(p_actor, 'branding.manage');
  if jsonb_typeof(p_landing) <> 'object' or jsonb_typeof(p_login) <> 'object' then raise exception 'VALIDATION_ERROR'; end if;
  select * into v_old from site_content;
  update site_content set landing = p_landing, login = p_login, version = version + 1, updated_by = p_actor, updated_at = app_now() where id returning version into v_version;
  perform write_audit(p_actor, 'SITE_CONTENT_CHANGED', 'site_content', 'singleton',
    jsonb_build_object('version', v_old.version, 'landing', v_old.landing, 'login', v_old.login),
    jsonb_build_object('version', v_version, 'landing', p_landing, 'login', p_login));
  return v_version;
end $$;

create or replace function set_site_image(p_actor uuid, p_slot text, p_mime text, p_data_b64 text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_version int;
begin
  perform require_permission(p_actor, 'branding.manage');
  if p_slot !~ '^[a-z0-9][a-z0-9-]{0,39}$' then raise exception 'VALIDATION_ERROR'; end if;
  if not exists (select 1 from site_images where slot = p_slot) and (select count(*) from site_images) >= 40 then
    raise exception 'VALIDATION_ERROR' using detail = 'at most 40 images';
  end if;
  insert into site_images (slot, mime, data_b64) values (p_slot, p_mime, p_data_b64)
    on conflict (slot) do update set mime = excluded.mime, data_b64 = excluded.data_b64, version = site_images.version + 1, updated_at = app_now()
    returning version into v_version;
  perform write_audit(p_actor, 'SITE_IMAGE_CHANGED', 'site_image', p_slot, null, jsonb_build_object('slot', p_slot, 'mime', p_mime, 'bytes', char_length(p_data_b64) * 3 / 4));
  return v_version;
end $$;

create or replace function delete_site_image(p_actor uuid, p_slot text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_permission(p_actor, 'branding.manage');
  delete from site_images where slot = p_slot;
  perform write_audit(p_actor, 'SITE_IMAGE_REMOVED', 'site_image', p_slot, null, jsonb_build_object('slot', p_slot));
end $$;

-- after a save: images that no part of the page refers to any more are removed
create or replace function prune_site_images(p_actor uuid, p_keep text[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_removed int;
begin
  perform require_permission(p_actor, 'branding.manage');
  with gone as (delete from site_images where slot <> all (coalesce(p_keep, '{}'::text[])) returning slot)
  select count(*) into v_removed from gone;
  if v_removed > 0 then perform write_audit(p_actor, 'SITE_IMAGES_PRUNED', 'site_image', 'unused', null, jsonb_build_object('removed', v_removed)); end if;
  return v_removed;
end $$;

select lock_down_function_grants();
