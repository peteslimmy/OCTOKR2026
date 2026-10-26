/**
 * Update the theme and quarterly objectives for 2025 and 2026.
 * WARNING: This script clears previous strategy data to ensure clean state based on the new requirements.
 * This migration only runs if the organisation with the specific ID exists.
 */

-- Check if the organisation exists before proceeding
DO $$
DECLARE
    org_id uuid := 'c4cccd68-494f-4bc0-9f65-b91bbbcc5f40'::uuid;
    theme_2025 text := 'Innovative Data Driven Business Enhancement Through Measurable Structural Product Advancement And Deepened Customer Value Offerings (Fostering The Culture Of Innovation And Thought Leadership, Leveraging Data Driven Insight For Product Enhancement And Structural Operational Efficiency To Entrench Client Ownership And Business Growth)';
    theme_2026 text := 'GROWTH BY DESIGN (Advance intentional business and organizational growth by design, anchored in research and data-driven insights, accelerated through strategically balanced teams and partnerships, enabled by operational excellence, amplified by brand propagation, and delivered through disciplined execution and inclusive thought leadership.)';

    -- IDs
    v_t2025 uuid; v_t2026 uuid;

    -- Helper for quarters
    q_id uuid;
    org_exists boolean;
BEGIN
    -- Check if organisation exists
    SELECT EXISTS(SELECT 1 FROM organisations WHERE id = org_id) INTO org_exists;
    IF NOT org_exists THEN
        RAISE NOTICE 'Organisation % not found, skipping strategy refresh', org_id;
        RETURN;
    END IF;

    -- 1. Insert Annual Themes
    INSERT INTO annual_themes (organisation_id, year, theme)
    VALUES (org_id, 2025, theme_2025) RETURNING id INTO v_t2025;

    INSERT INTO annual_themes (organisation_id, year, theme)
    VALUES (org_id, 2026, theme_2026) RETURNING id INTO v_t2026;

    -- 2. Ensure Quarters exist (Using foundation's create_year_quarters)
    -- We'll manually insert if not existing to be safe
    INSERT INTO quarters (organisation_id, year, quarter_number, starts_on, ends_on, status)
    SELECT org_id, y, q,
           make_date(y, (q-1)*3+1, 1),
           (make_date(y, (q-1)*3+1, 1) + interval '3 months' - interval '1 day')::date,
           'PLANNED'
    FROM generate_series(2025, 2026) y, generate_series(1, 4) q
    ON CONFLICT DO NOTHING;

    -- 3. Objectives 2025
    -- Q1
    SELECT id INTO q_id FROM quarters WHERE year = 2025 AND quarter_number = 1;
    INSERT INTO quarterly_objectives (quarter_id, title) VALUES (q_id, 'Business Advancement Through Intentional Structural Reformation, Data-Informed Product Evolution, And Entrenchment Of Processes And Technology');

    -- Q2
    SELECT id INTO q_id FROM quarters WHERE year = 2025 AND quarter_number = 2;
    INSERT INTO quarterly_objectives (quarter_id, title) VALUES (q_id, 'Realigning Business And Product Team Structure To Enable Data-Driven Service Evolution And Accelerate Client Ownership.');

    -- Q3
    SELECT id INTO q_id FROM quarters WHERE year = 2025 AND quarter_number = 3;
    INSERT INTO quarterly_objectives (quarter_id, title) VALUES (q_id, 'Leveraging standardized operations & data-driven insights to advance product development, improve service outcomes, and meet the evolving expectations of internal & external stakeholders.');

    -- Q4
    SELECT id INTO q_id FROM quarters WHERE year = 2025 AND quarter_number = 4;
    INSERT INTO quarterly_objectives (quarter_id, title) VALUES (q_id, 'Harnessing data-driven insights and standardized frameworks to foster organizational efficiency, strengthen collaboration and communication, and build stakeholder confidence through a culture of client ownership.');

    -- 4. Objectives 2026
    -- Q1
    SELECT id INTO q_id FROM quarters WHERE year = 2026 AND quarter_number = 1;
    INSERT INTO quarterly_objectives (quarter_id, title) VALUES (q_id, 'Achieving sustainable business growth by establishing a high-performing, well-structured team.');

    -- Q2
    SELECT id INTO q_id FROM quarters WHERE year = 2026 AND quarter_number = 2;
    INSERT INTO quarterly_objectives (quarter_id, title) VALUES (q_id, 'Accelerate Impact through Operational Excellence, Expanded Service & Product Footprint, High-Performing Teams, and Deeper Client Ownership.');

    -- Q3
    SELECT id INTO q_id FROM quarters WHERE year = 2026 AND quarter_number = 3;
    INSERT INTO quarterly_objectives (quarter_id, title) VALUES (q_id, 'Deliver measurable organizational growth through strategic partnerships, process efficiency, timely execution, accountability, and AI-powered data insight approach.');

    -- Q4
    SELECT id INTO q_id FROM quarters WHERE year = 2026 AND quarter_number = 4;
    INSERT INTO quarterly_objectives (quarter_id, title) VALUES (q_id, 'Deliver measurable business outcomes by strengthening team capacity, using data-driven insights, ownership & streamlining internal processes.');

END $$;
