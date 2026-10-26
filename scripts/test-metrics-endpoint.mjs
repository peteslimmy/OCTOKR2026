/**
 * Test script for the /metrics endpoint
 * Verifies the /metrics endpoint returns valid Prometheus metrics
 */

import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:3000";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "test-anon-key";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Test /metrics endpoint
async function testMetricsEndpoint() {
  console.log("Testing /metrics endpoint...");

  try {
    const res = await fetch(`${SUPABASE_URL}/api/metrics`, {
      method: "GET",
      headers: {
        "x-correlation-id": "test-001",
        "accept": "text/plain",
      },
    });

    const text = await res.text();

    if (res.status === 200 && text.length > 0) {
      console.log(`✅ /metrics endpoint returned ${text.length} bytes`);

      // Check for common Prometheus metric patterns
      const patterns = [
        /http_requests_total/,
        /db_query_duration_seconds/,
        /weekly_reports_total/,
        /violations_total/,
        /violation_fund_balance/,
        /access_denied_total/,
        /mfa_enrollments_total/,
        /scheduler_heartbeat_age_seconds/,
        /email_queue_size/,
        /background_jobs_total/,
      ];

      let foundPatterns = 0;
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          foundPatterns++;
        }
      }

      console.log(`📊 Found ${foundPatterns}/${patterns.length} Prometheus metric patterns`);

      if (foundPatterns >= 5) {
        console.log("✅ Metrics endpoint is working correctly - contains expected Prometheus metrics");
        process.exit(0);
      } else {
        console.log("⚠️  Metrics endpoint returned data but fewer expected patterns found");
        console.log("First 500 chars:", text.substring(0, 500));
        process.exit(1);
      }
    } else {
      console.log(`❌ /metrics endpoint failed: status ${res.status}`);
      console.log(`Response: ${text.substring(0, 200)}`);
      process.exit(1);
    }
  } catch (error) {
    console.log(`❌ /metrics endpoint error: ${error.message}`);
    process.exit(1);
  }
}

// Also test basic health
async function testHealthEndpoint() {
  console.log("\nTesting /api/health endpoint...");

  try {
    const res = await fetch(`${SUPABASE_URL}/api/health`, {
      method: "GET",
      headers: {
        "x-correlation-id": "test-002",
      },
    });

    const json = await res.json();

    if (res.status === 200 && json.status === "ok") {
      console.log("✅ Health endpoint returning ok");
    } else {
      console.log(`⚠️  Health endpoint: status=${json.status || json.error || 'unknown'}`);
    }
  } catch (error) {
    console.log(`⚠️  Health endpoint error: ${error.message}`);
  }
}

testMetricsEndpoint().then(() => testHealthEndpoint());