-- 4COREPAL phase 2 (continued): the provider's price per million tokens is configuration, not code, and the web tier can ask how much budget is left.
-- Prices start at 0 on purpose: until an administrator enters the provider's current price, cost is recorded as 0 and the daily ceiling cannot trigger.
-- A ceiling that appears to work on an invented price would be worse than one that plainly is not set up.
insert into ai_settings (key, value, kind, label, help) values
  ('price_input_per_mtok_usd',  '0', 'number', 'Provider price per million input tokens (USD)',  'Enter the provider''s current price. 0 records no cost.'),
  ('price_output_per_mtok_usd', '0', 'number', 'Provider price per million output tokens (USD)', 'Enter the provider''s current price. 0 records no cost.');

-- Before a call: is the module on, is the day's ceiling reached, how many calls has this person made in the last hour.
create or replace function ai_usage_status(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'enabled',        ai_enabled(),
    'todayUsd',       coalesce((select sum(cost_usd) from ai_usage where occurred_at >= date_trunc('day', app_now())), 0),
    'ceilingUsd',     coalesce((select (value)::text::numeric from ai_settings where key = 'daily_cost_ceiling_usd'), 0),
    'userCallsHour',  (select count(*) from ai_usage where user_id = p_user and outcome = 'OK' and occurred_at >= app_now() - interval '1 hour'),
    'userLimitHour',  coalesce((select (value)::text::int from ai_settings where key = 'user_rate_limit_per_hour'), 0),
    'timeoutSeconds', coalesce((select (value)::text::int from ai_settings where key = 'request_timeout_seconds'), 30),
    'maxRetries',     coalesce((select (value)::text::int from ai_settings where key = 'max_retries'), 2),
    'inputPrice',     coalesce((select (value)::text::numeric from ai_settings where key = 'price_input_per_mtok_usd'), 0),
    'outputPrice',    coalesce((select (value)::text::numeric from ai_settings where key = 'price_output_per_mtok_usd'), 0)
  );
$$;
select lock_down_function_grants();
