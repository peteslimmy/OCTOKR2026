-- Operations hardening (ADR-071, docs/30 G-2, G-3, S-5).
--  * a rate limiter shared by every copy of the web application (the in-memory one forgets on restart and is per instance),
--  * a heartbeat written by every run of the scheduler, so a silent scheduler can be seen,
--  * one function that reports the health of the things a monitor needs to watch, including whether a development clock override is present.

-- ------------------------------------------------------------------ shared rate limiter
-- Unlogged on purpose: counts of recent attempts are worthless after a crash, and writing them must stay cheap.
create unlogged table rate_limit_hits (
  key text not null,
  at  timestamptz not null default clock_timestamp()
);
create index rate_limit_hits_key_at on rate_limit_hits (key, at);

-- Records one attempt and says whether the limit is now exceeded (more than p_max attempts in the last p_window_seconds).
create or replace function rate_limit_hit(p_key text, p_max int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 300 or p_max < 1 or p_window_seconds < 1 then raise exception 'VALIDATION_ERROR'; end if;
  delete from rate_limit_hits where key = p_key and at < clock_timestamp() - make_interval(secs => p_window_seconds);
  insert into rate_limit_hits (key) values (p_key);
  select count(*) into v_n from rate_limit_hits where key = p_key;
  if random() < 0.01 then delete from rate_limit_hits where at < clock_timestamp() - interval '1 day'; end if;       -- housekeeping, nothing here is older than the longest window
  return v_n > p_max;
end $$;

-- ------------------------------------------------------------------ scheduler heartbeat
create table job_heartbeats (
  job         text primary key,
  last_run_at timestamptz not null,
  runs        bigint not null default 1
);
alter table job_heartbeats enable row level security;                  -- no policy: only the service role and functions below read it

create or replace function record_job_heartbeat(p_job text default 'scheduler') returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into job_heartbeats (job, last_run_at) values (p_job, clock_timestamp())
  on conflict (job) do update set last_run_at = excluded.last_run_at, runs = job_heartbeats.runs + 1;
$$;

-- every run of the scheduler leaves a heartbeat, whoever started it (the web route or a database scheduler)
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'run_scheduled_jobs';
  v_new := replace(v_def, 'return v_result || jsonb_build_object(', 'perform record_job_heartbeat(); return v_result || jsonb_build_object(');
  if v_new = v_def then raise exception 'expected text not found in run_scheduled_jobs'; end if;
  execute v_new;
end $$;

-- ------------------------------------------------------------------ health
-- pure, so it can be tested without touching real database settings
create or replace function clock_override_in(p_settings text[]) returns boolean
language sql immutable as $$
  select coalesce(bool_or(c like 'app.dev_clock=%' or c like 'app.test_now=%' or c = 'app.environment=development'), false) from unnest(p_settings) c;
$$;

create or replace function clock_override_present() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select clock_override_in(coalesce((select array_agg(c) from pg_db_role_setting s cross join lateral unnest(s.setconfig) c
                                      where s.setdatabase = (select oid from pg_database where datname = current_database())), '{}'));
$$;

-- named ops_ (not read_) on purpose: read_ functions are open to signed-in users, this one is for the service role only
create or replace function ops_health() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'database', 'ok',
    'scheduler_last_run_at', (select last_run_at from job_heartbeats where job = 'scheduler'),
    'scheduler_age_seconds', (select extract(epoch from clock_timestamp() - last_run_at)::int from job_heartbeats where job = 'scheduler'),
    'email_pending', (select count(*) from email_outbox where status = 'PENDING'),
    'email_oldest_pending_minutes', (select extract(epoch from clock_timestamp() - min(created_at))::int / 60 from email_outbox where status = 'PENDING'),
    'email_failed', (select count(*) from email_outbox where status = 'FAILED'),
    'job_failures_24h', (select count(*) from audit_logs where action = 'JOB_FAILED' and occurred_at > app_now() - interval '24 hours'),
    'clock_override_present', clock_override_present(),
    'schedule_version', (select max(version) from reporting_schedule_versions));
$$;

select lock_down_function_grants();
