# Dashboard Cost Empty State

Date: 2026-07-31

## Basis

The Dashboard receives cost and usage separately through `gatewayDataStore`. `getDailyCostAvailability` already distinguishes priced cost from dated Token activity, so an unpriced usage history must continue to render as a Token chart rather than being treated as empty cost data.

## Previous Behavior

When no priced or Token data was available, the 14-day dashboard chart area showed only an icon and one short line. It did not identify whether the next useful action was configuring a model, opening a conversation, or retrying the read.

## Target Behavior

- Loading, disconnected, error, priced-cost, and unpriced-Token states retain their existing meanings.
- A single unpriced Token bucket, or Token totals without a drawable component series, uses `DashboardTokenUsageSummary` rather than leaving an empty chart canvas. It shows only reported window, total, active-day, latest-day, and input/output/cache/unclassified Token breakdowns.
- The Token area chart is reserved for two or more drawable dated Token buckets. This avoids presenting a one-point record as a trend.
- The no-data branch uses `DashboardCostEmptyState` as a workspace overview: it shows the real 14-day reporting window together with the loaded Gateway session count, active-agent count, and available-model count. It does not invent an activity trend, cost, or usage value.
- When a usable model is configured, the primary action opens the conversation. Without one, it opens provider configuration. A refresh action remains available in either state.
- No amount or usage count is invented when the Gateway returns no relevant records.

## Verification

- `src/pages/Dashboard/DashboardCostEmptyState.test.ts` verifies the shared empty state, real navigation actions, refresh behavior, and chart-versus-summary selection for unpriced usage.
- `src/pages/Dashboard/dashboardData.test.ts` verifies single-bucket usage aggregation and the multi-day Token trend threshold.
- Desktop visual validation remains required for compact and wide window sizes.
