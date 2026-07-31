import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const componentSource = readFileSync(new URL('./DashboardCostEmptyState.tsx', import.meta.url), 'utf8');
const summarySource = readFileSync(new URL('./DashboardTokenUsageSummary.tsx', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('the dashboard no-usage view uses actual workspace counts and routes users to a real next action', () => {
  assert.match(componentSource, /data-dashboard-cost-empty/);
  assert.match(componentSource, /sessionCount: number/);
  assert.match(componentSource, /activeAgentCount: number/);
  assert.match(componentSource, /modelCount: number/);
  assert.match(componentSource, /<OverviewMetric/);
  assert.match(componentSource, /hasProviders \? onOpenConversation : onConfigureProviders/);
  assert.match(componentSource, /loading=\{refreshing\}/);
  assert.match(dashboardSource, /<DashboardCostEmptyState/);
  assert.match(dashboardSource, /sessionCount=\{sessions\.length\}/);
  assert.match(dashboardSource, /activeAgentCount=\{agentList\.length\}/);
  assert.match(dashboardSource, /modelCount=\{availableModels\.length\}/);
  assert.match(dashboardSource, /onOpenConversation=\{\(\) => navigate\('\/chat'\)\}/);
  assert.match(dashboardSource, /onConfigureProviders=\{\(\) => navigate\('\/config'\)\}/);
});

test('the chart remains a token chart when usage exists without pricing', () => {
  assert.match(dashboardSource, /const hasTokenTrend = hasTokenChartData && tokenUsageOverview\.hasTrend/);
  assert.match(dashboardSource, /const shouldRenderChart = hasChartData \|\| hasTokenTrend/);
  assert.match(dashboardSource, /<DashboardTokenUsageSummary overview=\{tokenUsageOverview\} \/>/);
  assert.match(dashboardSource, /metric=\{hasChartData \? 'cost' : 'tokens'\}/);
});

test('single-point token usage has a localized summary rather than an empty chart canvas', () => {
  assert.match(summarySource, /data-dashboard-token-summary/);
  assert.match(summarySource, /rgb\(var\(--aegis-accent\)\)/);
  assert.match(summarySource, /t\('dashboard\.usageUnpriced'\)/);
  assert.match(summarySource, /t\('dashboard\.costPricingUnavailable'\)/);
  assert.match(summarySource, /t\('analytics\.days'/);
  assert.match(summarySource, /t\('calendar\.category\.other'\)/);
});
