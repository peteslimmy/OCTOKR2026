-- The logo is drawn at a height the Super Admin chooses, with its own proportions (it was forced into a small square box).
-- The size is part of the branding row; set_branding takes it as an optional fifth argument so existing four-argument callers keep working.
alter table app_branding add column logo_height smallint not null default 32 check (logo_height between 16 and 64);

drop function if exists set_branding(uuid, text, text, text);
create or replace function set_branding(p_actor uuid, p_app_name text, p_short_name text, p_primary_color text, p_logo_height int default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old app_branding; v_height int;
begin
  perform require_permission(p_actor, 'branding.manage');
  if p_primary_color !~ '^#[0-9a-fA-F]{6}$' or char_length(btrim(p_app_name)) not between 1 and 60 or char_length(btrim(p_short_name)) not between 1 and 3 then
    raise exception 'VALIDATION_ERROR';
  end if;
  if p_logo_height is not null and p_logo_height not between 16 and 64 then
    raise exception 'VALIDATION_ERROR' using detail = 'the logo height must be between 16 and 64 pixels';
  end if;
  select * into v_old from app_branding;
  v_height := coalesce(p_logo_height, v_old.logo_height);
  update app_branding set app_name = btrim(p_app_name), short_name = btrim(p_short_name), primary_color = lower(p_primary_color),
         logo_height = v_height, updated_by = p_actor, updated_at = app_now() where id;
  perform write_audit(p_actor, 'BRANDING_CHANGED', 'app_branding', 'singleton',
    jsonb_build_object('appName', v_old.app_name, 'shortName', v_old.short_name, 'primaryColor', v_old.primary_color, 'logoHeight', v_old.logo_height),
    jsonb_build_object('appName', btrim(p_app_name), 'shortName', btrim(p_short_name), 'primaryColor', lower(p_primary_color), 'logoHeight', v_height));
end $$;

select lock_down_function_grants();
