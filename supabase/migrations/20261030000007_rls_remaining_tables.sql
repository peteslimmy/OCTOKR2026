-- Row-level security on the eight public tables that had none (audit finding F-012). None of them grants any privilege to `anon` or
-- `authenticated`, so users could not reach them anyway; this makes that a second, independent barrier. With RLS on and no policy, only the
-- table owner (the SECURITY DEFINER functions) and the service role (which bypasses RLS) can read or write them, which is exactly how the
-- application uses them. A test (tests/db/rls_invariants.test.ts) now fails if any public table is ever created without RLS.
alter table email_event_types       enable row level security;
alter table employee_kpi_snapshots  enable row level security;
alter table employee_kpis           enable row level security;
alter table financial_projections   enable row level security;
alter table kr_target_snapshots     enable row level security;
alter table kr_targets              enable row level security;
alter table notification_settings   enable row level security;
alter table rate_limit_hits         enable row level security;
