import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = fs.readFileSync(path.join(here, 'index.tsx'), 'utf8');
const components = fs.readFileSync(path.join(here, 'components.tsx'), 'utf8');
const gateway = fs.readFileSync(path.join(here, '../../services/gateway/index.ts'), 'utf8');
const gatewayStore = fs.readFileSync(path.join(here, '../../stores/gatewayDataStore.ts'), 'utf8');

test('dashboard compaction calls the canonical Gateway operation with real feedback', () => {
  assert.match(gateway, /async compactSession\(sessionKey/);
  assert.match(gateway, /message: '\/compact'/);
  assert.match(dashboard, /await gateway\.compactSession\(sessionKey\)/);
  assert.doesNotMatch(dashboard, /aegis:compress-session/);
});

test('non-session activity rows cannot open an empty chat tab', () => {
  assert.match(dashboard, /onClick=\{item\.sessionKey[\s\S]*\? \(\) =>/);
  assert.match(components, /if \(!onClick\) return <div/);
});

test('dashboard uses readable breakpoint layouts at the supported minimum window size', () => {
  assert.match(dashboard, /grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4/);
  assert.match(dashboard, /text-\[26px\].*tabular-nums/);
  assert.match(dashboard, /text-\[14px\] font-semibold/);
});

test('dashboard context and budget values use canonical metric helpers', () => {
  assert.match(dashboard, /percentageOf\(ctxUsed, ctxMax\)/);
  assert.match(dashboard, /budgetProgress\(rollingCost, budgetLimit\)/);
  assert.doesNotMatch(dashboard, /tokenUsage\?\.percentage/);
});

test('dashboard global usage requests cover every agent', () => {
  assert.match(gatewayStore, /usage\.cost', \{ days: 30, agentScope: 'all' \}/);
  assert.match(gatewayStore, /sessions\.usage', \{ limit: 100, agentScope: 'all' \}/);
  assert.match(gateway, /getCostSummary[\s\S]*agentScope: 'all'/);
});

test('dashboard uses the canonical agent display name and preserves zero-cost date axes', () => {
  assert.match(dashboard, /getAgentDisplayName\(/);
  assert.match(dashboard, /const hasChartData = chartData\.length > 0/);
  assert.doesNotMatch(dashboard, /hasChartCost/);
});

test('activity rows expose session, model, tokens, and exact activity time', () => {
  assert.match(dashboard, /model=\{item\.model\}/);
  assert.match(dashboard, /tokens=\{item\.tokens\}/);
  assert.match(dashboard, /timeTitle=\{item\.timeTitle\}/);
  assert.match(components, /title=\{modelTitle\}/);
  assert.doesNotMatch(dashboard, /totalCompactions/);
});

test('quick actions expose real product routes in addition to compaction', () => {
  assert.match(dashboard, /navigate\('\/chat\?agent=main&new=1'\)/);
  assert.match(dashboard, /navigate\('\/agents'\)/);
  assert.match(dashboard, /navigate\('\/analytics'\)/);
  assert.match(dashboard, /navigate\('\/skills'\)/);
  assert.match(dashboard, /navigate\('\/activity'\)/);
  assert.match(dashboard, /navigate\('\/ai-workspace'\)/);
  assert.match(dashboard, /navigate\('\/terminal'\)/);
  assert.match(dashboard, /navigate\('\/cron'\)/);
  assert.match(dashboard, /isFeatureEnabled\('chat'\)/);
});
