# 4CORE-OKR Business Analysis Skill

## Purpose
Convert business intent into precise, testable system behavior without inventing unsupported policy.

## Read First
- `docs/03-FUNCTIONAL-REQUIREMENTS.md`
- `docs/04-BUSINESS-RULES.md`
- `docs/05-USER-JOURNEYS.md`
- `docs/08-STATE-MACHINES.md`
- `docs/20-ACCEPTANCE-CRITERIA.md`

## For Every Workflow Capture
- Requirement ID
- Actor
- Trigger
- Preconditions
- Main flow
- Alternate flow
- Exception flow
- Validation
- State transition
- Data changes
- Score impact
- Financial impact
- Audit impact
- Notification impact
- Security constraints
- Acceptance criteria

## Critical Business Facts
- Weekly report belongs to the BU, not the individual BU Lead.
- BU Leads are isolated to their BU.
- Submit Report is explicit.
- Submission does not immediately lock content.
- Tuesday 18:00 locks content.
- Following Tuesday 11:00 finalizes the report.
- Held/SKIPPED physical-session state does not change normal reporting lock times; an officially declared ORGANIZATION_HOLIDAY is a separate reporting-period state that suspends the report obligation and excludes that week from quarterly score denominator. There is no CANCELLED OKR workflow.
- Every BU must have at least one Goal.
- Goal status derives from Tasks.
- SMART failure is a warning only.
- Stretch Goals contribute to score.
- No submission is 0% and NON_COMPLIANT.
- Integrity correction is mandatory for post-lock DONE→NOT_DONE corrections.
- HR/Admin raises disbursement requests; Finance approves/rejects.

## Never
- Infer policy silently.
- Treat UI behavior as business truth.
- Turn derived data into editable facts.
- Reintroduce superseded legacy workflows.

## Definition of Done
Another engineer can implement the workflow without guessing business meaning.
