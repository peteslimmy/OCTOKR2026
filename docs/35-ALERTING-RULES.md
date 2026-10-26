# Alerting Rules

Defined in YAML for Prometheus Alertmanager. These rules monitor the health and stability of the 4CORE-OKR application.

## Alert Rules

```yaml
groups:
  - name: "4core-okr-rules"
    interval: 60s
    rules:

      # --- Health & Availability ---

      - alert: ApplicationUnhealthy
        expr: |
          !up or scalar(nginx_ingress_controller_status_health{job="4core-okr"} == "unhealthy")
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "4CORE-OKR application is unhealthy"
          description: |
            The application health check is returning unhealthy.
            Check /api/health endpoint and application logs.

      - alert: HealthCheckFailing
        expr: |
          not http_response_code{handler="health",code="200"} > 0
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Health check endpoint returning non-200"
          description: |
            The /api/health endpoint is not returning 200 OK.
            This may indicate database or dependency issues.

      - alert: SchedulerSilent
        expr: |
          (last_over_time(api_internal_health_scheduler_age_seconds[1m]) > 60)
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Scheduler heartbeat stale (age > 60s)"
          description: |
            The internal scheduler heartbeat has not been updated in over 60 seconds.
            Check the job scheduler process.

      - alert: SchedulerFailed
        expr: |
          api_internal_health_critical{job="4core-okr"} == 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Scheduler critical alert triggered"
          description: |
            The /api/internal/health endpoint reports a critical condition.
            Review health metrics and application logs.

      # --- Error Rates ---

      - alert: FivexxRateHigh
        expr: |
          rate(http_response_codes{handler=~".*",code="5.."}[1m]) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "5xx error rate > 5% over 1 minute"
          description: |
            The application is generating 5xx errors at a rate exceeding 5%.
            Investigate recent deployments, database connectivity, or resource exhaustion.

      - alert: FourxxRateHigh
        expr: |
          rate(http_response_codes{handler=~".*",code="4.."}[1m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "4xx error rate > 10% over 5 minutes"
          description: |
            The application is generating 4xx errors at a rate exceeding 10%.
            May indicate authorization issues, missing resources, or client errors.

      # --- Authentication & Authorization ---

      - alert: MFAEnrollmentFailures
        expr: |
          rate(mfa_enrollment_failures_total[5m]) > 3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "MFA enrollment failures detected"
          description: |
            More than 3 MFA enrollment failures in 5 minutes.
            May indicate brute-force attacks or configuration issues.

      - alert: AccessDeniedBurst
        expr: |
          rate(record_access_denied_total[1m]) > 10
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Burden of access denied events"
          description: |
            More than 10 access denied events per minute.
            Investigate for authorization misconfigurations or potential attacks.

      # --- Database & Performance ---

      - alert: DBConnectionPoolExhausted
        expr: |
          pg_pool_usage{job="postgres"} > 0.95
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL connection pool nearly exhausted"
          description: |
            PostgreSQL connection pool usage is above 95%.
            Check for long-running queries or connection leaks.

      - alert: DBQueryLatencyHigh
        expr: |
          avg(pg_query_duration_seconds_avg[5m]) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Average PostgreSQL query latency > 2s"
          description: |
            Average PostgreSQL query latency exceeds 2 seconds.
            Review slow queries and database indexing.

      # --- Business Metrics ---

      - alert: NoReportsThisWeek
        expr: |
          sum by (week_id) (active_weeks_total) == 0
        for: 1h
        labels:
          severity: info
        annotations:
          summary: "No active reports for a given week"
          description: |
            No weekly reports are active for a given week identifier.
            This may be expected if the week is between quarters, or may indicate a data issue.

      # --- Email & Notifications ---

      - alert: EmailDeliveryFailures
        expr: |
          rate(email_outbox_status_failed_total[5m]) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Email delivery failures exceeding threshold"
          description: |
            More than 5 email delivery failures in 5 minutes.
            Check SMTP configuration and provider health.

      - alert: NotificationQueueBacklog
        expr: |
          notification_queue_size > 100
        for: 5m
        labels:
          severity: info
        annotations:
          summary: "Notification queue backlog growing"
          description: |
            Notification queue has more than 100 pending items.
            May indicate delayed notifications or processing issues.

      # --- Financial Integrity ---

      - alert: FundBalanceNegative
        expr: |
          fund_balance < 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Violation fund balance is negative"
          description: |
            The violation fund balance has gone negative, which should be impossible.
            This indicates a data corruption or concurrency issue that requires immediate investigation.

      # --- Security ---

      - alert: SecretScanningDetected
        expr: |
          secret_scanning_last_run_failed == 1
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "Secret scanning detected potential credentials"
          description: |
            Secret scanning (gitleaks/trufflehog) detected potential credentials in the codebase.
            Review and rotate any exposed secrets immediately.
```

## Alertmanager Configuration

```yaml
receivers:
  - name: "ops-team"
    email_configs:
      - to: "ops@example.com"
        from: "alerts@example.com"
        smarthost: "smtp.example.com:587"
        auth_username: "alerts@example.com"
        auth_password: "<secret>"
  - name: "on-call"
    slack_configs:
      - channel: "#alerts"
        api_url: "<slack-webhook-url>"

route:
  group_by: ["alertname", "cluster"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 12h
  receiver: "on-call"
  routes:
    - match:
        severity: critical
      receiver: "on-call"
      continue: true
    - match:
        severity: warning
      receiver: "ops-team"

inhibit:
  - source: "critical"
    target: "warning"
    equal: ["alertname"]
  - source: "critical"
    target: "info"
    equal: ["alertname"]
```

## Rule Rationale

| Alert | Why It Matters |
|-------|---------------|
| `ApplicationUnhealthy` | Catches app crashes early before users are impacted |
| `FivexxRateHigh` | 5xx errors signal server-side bugs or infrastructure issues |
| `AccessDeniedBurst` | Potential authorization bypass or attack |
| `DBConnectionPoolExhausted` | Connection leaks will bring down the DB |
| `FundBalanceNegative` | Financial data corruption — always investigate |
| `SecretScanningDetected` | Credential exposure is a security emergency |
| `EmailDeliveryFailures` | Reminders and notifications stop working |
| `NoReportsThisWeek` | Silent data issue — no reports may mean broken workflow |

## Threshold Selection Guide

- **Critical**: Immediate action required; service impact or security risk
- **Warning**: Investigate soon; may indicate emerging problems
- **Info**: Monitor; expected or benign in many cases

Adjust thresholds based on your traffic patterns and SLA requirements.