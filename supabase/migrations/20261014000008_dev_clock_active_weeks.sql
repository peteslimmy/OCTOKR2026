-- Development clock (ADR-036 addendum) and server-clock based "live weeks" read model.
--
-- The dev clock lets local environments exercise time-based locks without waiting for real Tuesdays.
-- It is honoured ONLY when BOTH database-level settings are present, which only a database owner can set
-- with ALTER DATABASE (never in a migration, never through the API):
--   alter database postgres set app.environment = 'development';
--   alter database postgres set app.dev_clock    = '2026-10-19T10:00:00+01:00';
-- Production must never set either; a startup check in /api/health reports if app.environment is not 'production'.

create or replace function app_now() returns timestamptz
language plpgsql stable as $$
declare v text;
begin
  if session_user = 'postgres' then                       -- test-suite override (direct superuser sessions only)
    v := current_setting('app.test_now', true);
    if v is not null and v <> '' then return v::timestamptz; end if;
  end if;
  if current_setting('app.environment', true) = 'development' then   -- local development clock
    v := current_setting('app.dev_clock', true);
    if v is not null and v <> '' then return v::timestamptz; end if;
  end if;
  return now();
end $$;

-- Reporting weeks that are open and not yet final-locked, judged by the authoritative server clock.
create or replace function read_active_weeks() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(w) || jsonb_build_object('phase', report_phase(w.id)) order by w.week_start_at desc), '[]'::jsonb)
  from reporting_weeks w where w.week_start_at <= app_now() and w.final_lock_at > app_now();
$$;

create or replace function read_server_time() returns timestamptz
language sql stable security invoker as $$ select app_now() $$;

create or replace function read_environment() returns jsonb
language sql stable security invoker as $$
  select jsonb_build_object('environment', coalesce(current_setting('app.environment', true), 'production'),
                            'clock_overridden', current_setting('app.environment', true) = 'development' and coalesce(current_setting('app.dev_clock', true), '') <> '');
$$;

select lock_down_function_grants();
