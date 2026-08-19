import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getDashboardTokenUsageOverview,
  getDailyCostAvailability,
  resolveDashboardChartMetric,
} from './dashboardData';

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

test('the dashboard selects token usage when records exist without pricing', () => {
  const availability = getDailyCostAvailability([
    { date: '2026-08-18', input: 10_000, missingCostEntries: 1 },
    { date: '2026-08-19', output: 2_000, missingCostEntries: 1 },
  ]);
  const overview = getDashboardTokenUsageOverview([
    {
      date: '08-18',
      input: 0,
      output: 0,
      cache: 0,
      other: 0,
      total: 0,
      inputTokens: 10_000,
      outputTokens: 0,
      cacheTokens: 0,
      totalTokens: 10_000,
    },
    {
      date: '08-19',
      input: 0,
      output: 0,
      cache: 0,
      other: 0,
      total: 0,
      inputTokens: 0,
      outputTokens: 2_000,
      cacheTokens: 0,
      totalTokens: 2_000,
    },
  ]);

  assert.equal(resolveDashboardChartMetric('auto', availability, overview), 'tokens');
});

test('single-point token usage has a localized summary rather than an empty chart canvas', () => {
  assert.match(summarySource, /data-dashboard-token-summary/);
  assert.match(summarySource, /rgb\(var\(--aegis-accent\)\)/);
  assert.match(summarySource, /t\('dashboard\.usageUnpriced'\)/);
  assert.match(summarySource, /t\('dashboard\.costPricingUnavailable'\)/);
  assert.match(summarySource, /t\('analytics\.days'/);
  assert.match(summarySource, /t\('calendar\.category\.other'\)/);
});
