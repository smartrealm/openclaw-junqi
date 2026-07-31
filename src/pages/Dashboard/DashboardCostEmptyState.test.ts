import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const componentSource = readFileSync(new URL('./DashboardCostEmptyState.tsx', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('the dashboard cost empty state routes users to a real next action', () => {
  assert.match(componentSource, /data-dashboard-cost-empty/);
  assert.match(componentSource, /hasProviders \? onOpenConversation : onConfigureProviders/);
  assert.match(componentSource, /loading=\{refreshing\}/);
  assert.match(dashboardSource, /<DashboardCostEmptyState/);
  assert.match(dashboardSource, /onOpenConversation=\{\(\) => navigate\('\/chat'\)\}/);
  assert.match(dashboardSource, /onConfigureProviders=\{\(\) => navigate\('\/config'\)\}/);
});

test('the chart remains a token chart when usage exists without pricing', () => {
  assert.match(dashboardSource, /\(hasChartData \|\| hasTokenChartData\) \? \(/);
  assert.match(dashboardSource, /metric=\{hasChartData \? 'cost' : 'tokens'\}/);
});
