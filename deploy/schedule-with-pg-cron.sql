-- OPTIONAL and UNTESTED here. Runs the scheduler from inside the database instead of from a container or a platform cron.
-- It needs the pg_cron and pg_net extensions (Supabase offers both) and the web application reachable from the database over HTTPS.
-- Run it once, by hand, in the SQL editor of the project, after replacing the two values below. It is not a migration: it holds an address and a secret.
--
-- Keep the secret in the project's vault, not in this text:
--   select vault.create_secret('<the JOBS_SECRET value>', 'okr_jobs_secret');
--
-- To stop it:  select cron.unschedule('okr-scheduler');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'okr-scheduler',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://okr.your-domain.example/api/internal/jobs/run',
    headers := jsonb_build_object('x-jobs-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'okr_jobs_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 50000
  );
  $$
);
