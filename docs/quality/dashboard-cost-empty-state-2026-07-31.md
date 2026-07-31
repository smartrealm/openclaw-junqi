# Dashboard Cost Empty State

Date: 2026-07-31

## Basis

The Dashboard receives cost and usage separately through `gatewayDataStore`. `getDailyCostAvailability` already distinguishes priced cost from dated Token activity, so an unpriced usage history must continue to render as a Token chart rather than being treated as empty cost data.

## Previous Behavior

When no priced or Token data was available, the 14-day dashboard chart area showed only an icon and one short line. It did not identify whether the next useful action was configuring a model, opening a conversation, or retrying the read.

## Target Behavior

- Loading, disconnected, error, priced-cost, and unpriced-Token states retain their existing meanings.
- The no-data branch uses `DashboardCostEmptyState`, which shows the real 14-day reporting window and the current actionable state.
- When a usable model is configured, the primary action opens the conversation. Without one, it opens provider configuration. A refresh action remains available in either state.
- No amount or usage count is invented when the Gateway returns no relevant records.

## Verification

- `src/pages/Dashboard/DashboardCostEmptyState.test.ts` verifies the shared empty state, real navigation actions, refresh behavior, and preservation of the unpriced Token chart branch.
- Desktop visual validation remains required for compact and wide window sizes.
