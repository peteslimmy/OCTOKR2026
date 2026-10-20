# 4CORE-OKR Design System

## Visual direction

- Minimal.
- Premium.
- Polished.
- Enterprise.
- Dark red and white organisational identity.
- Restrained use of accent colour.
- No unnecessary visual noise.

## Technology

- Tailwind CSS.
- shadcn/ui.
- Radix UI.

## Design tokens

Centralise:

- colours;
- typography;
- spacing;
- font weights;
- line heights;
- border radius;
- shadows;
- transitions;
- z-index;
- breakpoints;
- component states.

## Spacing grid

Spacing is a 4px scale: 0, 4, 8, 12, 16, 24, 32, 40, 48, 64. Every `padding`, `margin`, `gap`, `inset` and `space-*` value in `src/**` is a multiple of 4.

The scale is enforced, not merely preferred: the `4core/spacing-grid` ESLint rule (error severity) rejects any off-grid value in the spacing families `p*`, `m*`, `gap`, `space-*`, `inset`, `start`/`end`, `top`/`right`/`bottom`/`left`, after stripping responsive/state variants and the `!` modifier.

Arbitrary values and non-pixel units are permitted where a multiple of 4 cannot express the intent (sub-pixel insets, content-relative measures). They are the exception, and an exception must carry a stated reason at the call site - see the two `p-[1px]` uses in `src/components/ui/scroll-area.tsx`.

Avoid arbitrary one-off Tailwind values.

## Typography

Use a clear hierarchy:

- Display/hero
- Page title
- Section title
- Card title
- Body
- Metadata
- Label

Do not solve hierarchy by randomly changing font sizes page-by-page.

## Components

Standardise:

- Button
- IconButton
- Input
- Textarea
- Select
- Checkbox
- Switch
- Badge
- Card
- Table (`DataTable` primitive: required accessible `caption`, `scope="col"` headers, optional caller-owned sort/selection/column visibility, loading skeleton and error/empty states, pagination `footer`, and a card-per-row mobile layout below 768px - no route renders raw `<table>` markup)
- Dialog
- Drawer (`Drawer` root owns `onOpenChange`; the content swipe-dismisses on touch - 80px drag or a fast flick along the dismiss axis - while `touch-pan-y`/`touch-pan-x` keeps the other axis with the browser; `swipeDismiss={false}` opts out)
- Dropdown
- Tabs
- Tooltip
- Toast/notification (single event-bus API `toast.*` rendered only by `ToastProvider`; per-variant auto-dismiss 8000/6000/5000ms, see the UI/UX spec's Status feedback)
- Progress
- Timeline
- Empty state
- Error state
- Loading skeleton
- Pagination
- Breadcrumb
- Sidebar
- Header

## Status semantics

- Done = positive.
- Not Done = caution/negative.
- Undefined = neutral.
- Locked = neutral/immutable.
- Non-Compliant = critical.
- Stretch = distinct, not an error.

Never rely on colour alone.

## Motion

Use subtle, purposeful motion.

No decorative animations that reduce usability.

Respect reduced-motion preferences.

## Accessibility

Target WCAG 2.2 AA.

Every interactive control must be keyboard accessible and have a visible focus state.

Dialogs must trap focus correctly.

Tables must have useful headers and accessible labels.
