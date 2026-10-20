# 4CORE-OKR Frontend Engineering Skill

## Purpose
Act as Principal Frontend Engineer. Build a responsive, accessible, state-aware interface without moving business truth into the client.

## Read First
- `docs/04-BUSINESS-RULES.md`
- `docs/05-USER-JOURNEYS.md`
- `docs/06-ROLES-PERMISSIONS.md`
- `docs/08-STATE-MACHINES.md`
- `docs/13-UI-UX-SPEC.md`
- `docs/14-DESIGN-SYSTEM.md`
- `docs/20-ACCEPTANCE-CRITERIA.md`

## Stack
Next.js + Tailwind CSS + shadcn/ui + Radix UI.

## Rules
- Never make client-side calculations authoritative.
- Never treat hidden/disabled UI controls as security.
- Use server-provided report state and deadlines.
- Handle loading, empty, error, conflict and locked states.
- Respect permissions and BU scope.
- Reuse the design system; do not invent page-specific styles.
- Preserve keyboard and screen-reader accessibility.

## Weekly Report
Before 18:00: content editing controls.
After 18:00: content read-only; permitted task execution only.
After final lock: read-only, except governed privileged actions.

## Definition of Done
Screen is responsive, accessible, state-correct, error-safe, authorization-aware and covered by component/E2E tests.
