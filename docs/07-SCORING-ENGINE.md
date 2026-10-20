# 4CORE-OKR Scoring Engine

## 1. SMART quality score

SMART evaluation produces 0–100% quality score.

Dimensions:

- Specific
- Measurable
- Achievable
- Relevant
- Time-bound

Recommended transparent weighting: 20% each unless changed by an approved ADR.

SMART quality is independent from execution.

## 2. Goal execution status

Goal = DONE iff every active Task is DONE.

Otherwise Goal = NOT_DONE.

## 3. Weekly base score

Formula:

`baseScore = (doneGoals / totalGoals) * 100`

### Example

4 Goals, 3 Done:

`3/4 * 100 = 75%`

## 4. Equal goal weighting

Goal A with 2 Tasks and Goal B with 10 Tasks have equal weight.

Do not calculate score as:

`doneTasks / totalTasks`

## 5. Stretch Goals

Stretch Goals contribute equally to weekly score.

Example:

- 3 KR-aligned goals done
- 1 Stretch goal done
- 1 KR-aligned goal not done

Score = 4/5 = 80%.

## 6. Non-submission

No report submitted by weekly final lock:

- final weekly score = `0.00`;
- compliance = `NON_COMPLIANT`;
- the week remains part of the quarterly denominator only when it is a reportable NORMAL or SKIPPED-session week; an `ORGANIZATION_HOLIDAY` week is excluded and never treated as missing-report zero;
- an authorised exception may later permit a report to be submitted/reviewed and a controlled correction to replace this zero in a new quarterly-score version.

This is distinct from a submitted report that validly scores `0.00`. A submitted report awaiting review is also distinct from non-submission and must not be assigned zero solely because review is pending. Its quarter-finalisation treatment remains a separate open decision.

## 7. Integrity penalty — approved rule

Each applied integrity penalty is a percentage of the original weekly base score. Add all applicable applied penalty rates first, then apply the combined rate once. Do not deduct percentage points and do not compound sequentially.

Formula (rates expressed as decimals):

`combinedRate = sum(appliedPenaltyRates)`

`finalScore = roundTo2Decimals(max(0, baseScore * (1 - combinedRate)))`

The score floor is 0.00%. Final scores are rounded to two decimal places. Use deterministic decimal arithmetic consistently across server, database, exports and UI. Preserve the base score, each applied rate, combined rate, formula/rule version, calculated result and final score snapshot.

Examples:

- Base 80.00%, one 5% penalty: `80 × (1 - 0.05) = 76.00%`.
- Base 80.00%, two 5% penalties: `80 × (1 - (0.05 + 0.05)) = 72.00%`.
- Base 3.00%, one 10% penalty: `3 × (1 - 0.10) = 2.70%`.
- Combined rate at or above 100%: final score is `0.00%` due to the floor.

## 8. Penalty decision

Each DONE → NOT_DONE integrity correction requires:

- apply penalty;
- or waive penalty.

Waiver requires a reason.

## 9. Quarterly execution

`quarterlyExecutionScore = sum(weeklyContributionForEachEligibleReportingWeek) / eligibleReportingWeekCountInQuarter`

The denominator is every non-holiday calendar reporting week in the quarter, not merely weeks with submitted reports or available scores. A week declared `ORGANIZATION_HOLIDAY` is excluded from numerator and denominator because no report is required. Every NORMAL or SKIPPED-session week is included exactly once; a skipped physical OKR session does not change weighting. Use the final reviewed weekly score when available; use `0.00` for a report not submitted by weekly final lock in a reportable week unless an authorised exception is approved. Do not treat a holiday week as a missing report. Display the quarterly score to two decimal places and retain numerator, denominator count, eligible and excluded week references, excluded-holiday count, calculation version and timestamp. If a report was submitted but remains unreviewed, do not silently treat it as missing; quarter-finalisation treatment remains pending business-owner decision. If the quarter has no eligible reporting weeks, return `N/A` with reason `NO_ELIGIBLE_REPORTING_WEEKS`, not zero or division-by-zero.

## 10. Authorised late-report correction after quarter lock

An authorised exception may permit a missing report to be submitted and reviewed after its original weekly final lock, including after the quarter is locked. If the late report is accepted and review is complete:

1. Calculate its weekly score through the normal scoring engine and applicable rule/configuration versions.
2. Create an append-only amendment linking the late report/review, original `0.00` missing-report score, authorising decision, mandatory reason, actor, timestamps and correlation/audit reference.
3. Create a new quarterly score snapshot/version in which the late-week zero is replaced by the reviewed weekly score. Keep the same fixed denominator of eligible non-holiday reporting weeks, unless an authorised holiday-state amendment changes eligibility; if eligibility changes, calculate a new snapshot and preserve the old snapshot.
4. Preserve the original zero snapshot and previously published quarterly snapshot unchanged; retain the previous and new quarterly values and all calculation inputs.
5. Do not generally reopen the locked quarter or permit normal edits to other historical reports/strategy. The amendment action must require explicit server-side permission and emit audit evidence.

A late submission does not erase the fact that the report was initially late or its historical compliance event. The compliance-effect of an accepted exception beyond correcting the score must follow the approved exception decision and may not be silently rewritten.

## 11. Sub-KR execution

Track goal execution against each Sub-KR:

`subKrExecution = doneMappedGoals / totalMappedGoals * 100`

This is an execution metric, not necessarily the underlying KR business-outcome metric.

## 12. Ranking

Primary ranking: final weekly/quarterly execution score.

Potential tie-breakers should be configuration/ADR decisions rather than hidden logic.

## 13. Historical score integrity

Finalised score snapshots must not be recomputed from current penalty configuration.

Every snapshot records:

- total goals;
- completed goals;
- base score;
- total penalty rate;
- penalty amount;
- final score;
- calculation version;
- calculation timestamp.

## 14. Score test vectors

| Goals | Done | Base |
|---:|---:|---:|
| 1 | 1 | 100% |
| 1 | 0 | 0% |
| 4 | 3 | 75% |
| 5 | 4 | 80% |
| 10 | 7 | 70% |

| Base | Penalty | Final |
|---:|---:|---:|
| 80 | 5% | 76 |
| 80 | 10% | 72 |
| 3 | 10% | 2.7 |
| 0 | 10% | 0 |
