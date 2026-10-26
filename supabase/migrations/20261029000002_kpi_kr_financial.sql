-- KPI, KR targets, and financial projections
-- Migration: 20261029000002_kpi_kr_financial.sql

BEGIN;

-- 1. Employee KPIs
CREATE TABLE employee_kpis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    weight NUMERIC(5,2) NOT NULL DEFAULT 1.00,
    target_value NUMERIC(19,4) NOT NULL,
    unit TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT app_now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT app_now()
);

CREATE TABLE employee_kpi_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_kpi_id UUID NOT NULL REFERENCES employee_kpis(id) ON DELETE CASCADE,
    actual_value NUMERIC(19,4) NOT NULL,
    reporting_week_id UUID NOT NULL REFERENCES reporting_weeks(id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT app_now()
);

-- 2. KR Targets
CREATE TABLE kr_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_result_id UUID NOT NULL REFERENCES key_results(id) ON DELETE CASCADE,
    target_value NUMERIC(19,4) NOT NULL,
    unit TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER')),
    baseline_value NUMERIC(19,4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT app_now()
);

CREATE TABLE kr_target_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kr_target_id UUID NOT NULL REFERENCES kr_targets(id) ON DELETE CASCADE,
    actual_value NUMERIC(19,4) NOT NULL,
    quarter_id UUID NOT NULL REFERENCES quarters(id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT app_now()
);

-- 3. Financial Projections
CREATE TABLE financial_projections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    version_label TEXT NOT NULL,
    projection_type TEXT NOT NULL CHECK (projection_type IN ('REVENUE', 'COST', 'VIOLATION_FUND')),
    amount NUMERIC(19,2) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT app_now(),
    created_by UUID NOT NULL REFERENCES users(id)
);

-- RLS and audit setup
CREATE POLICY "RLS_employee_kpis_select" ON employee_kpis FOR SELECT USING (true);
CREATE POLICY "RLS_employee_kpi_snapshots_select" ON employee_kpi_snapshots FOR SELECT USING (true);
CREATE POLICY "RLS_kr_targets_select" ON kr_targets FOR SELECT USING (true);
CREATE POLICY "RLS_kr_target_snapshots_select" ON kr_target_snapshots FOR SELECT USING (true);
CREATE POLICY "RLS_financial_projections_select" ON financial_projections FOR SELECT USING (true);

-- Functions for audit and management (Security Definer)
-- ... (boilerplate for management functions would follow project patterns)

COMMIT;
