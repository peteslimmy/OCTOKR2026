# 05 — Workflow and state-transition audit

**Limitation up front:** no workflow that needs a reporting week could be run end to end, because every stored quarter is locked and Q4 2026 has no objective (F-022). What follows is source and database-test evidence plus the one workflow observed live.

## Observed live: add and delete a unit (UJ-adjacent admin workflow)
1. Opened Add unit (Super Admin, step-up already satisfied). 2. Created `ZTEST` under ADMIN with a location. 3. Database showed the row with parent and location; audit `BU_CREATED`. 4. The page listed it as "Child of ADMIN · 📍 Lagos". 5. Deleted it through the confirmation dialog (reason required and recorded); audit `BU_DELETED`; row gone; the other 17 units untouched. Result: **works end to end** after the repair (before it, the create call failed because the route sent fields the live function rejected).

## State machines read in source
| Machine | States | Guard | Findings |
|---|---|---|---|
| Quarter | PLANNED → ACTIVE → LOCKED | readiness checklist; auto-activate when complete; auto-lock when next begins | Q4 2026 stays PLANNED: correct refusal (F-022) |
| Weekly report | OPEN → CONTENT_LOCKED → FINAL_LOCKED (+ LATE_OPEN by authorised exception) | `guard_weekly_report` trigger; only review columns may change when final-locked | Extended for review/rejection columns; other columns still reject changes (tested) |
| Review | NOT_REVIEWED → REVIEWED; rejection is an event | `reject_weekly_report`, `review_weekly_report` | A rejected report cannot be resubmitted; the only route back is the late-report exception. Intentional per ADR-083, but a dead end for the BU Lead: the notification tells them it was rejected and they have no action |
| Quote | draft → submitted → approved → published → archived | `guard_weekly_quote` rejects any other step and any edit | No reject/return step: a bad quote can only be left unapproved |
| Disbursement | submitted → under review → approved → recorded/released; rejected | self-approval refused in DB (`DISBURSEMENT_SELF_APPROVAL`) | Covered by `finance` tests |
| Config / strategy / session / ledger changes | request → different approver → apply | two-person approval engine | Covered by their DB tests |

## Dead ends and recovery
- Rejected report (above): no BU-Lead action. Recommend either allowing resubmission through a controlled path or stating plainly in the notification that it is informational.
- User deletion: if the identity deletion fails after the application user is deleted there is no retry path (F-007).
- Evidence upload: now compensates (record removed) if storage fails (F-003).
- Test workflows: none protect the database (F-001).

## Not tested (see report 16)
Browser refresh/back/expired-session behaviour, network failure, cancellation/reopening paths, concurrent edit lease (`edit-session`), notification-failure handling.
