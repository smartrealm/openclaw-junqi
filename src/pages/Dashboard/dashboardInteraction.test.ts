import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = fs.readFileSync(path.join(here, 'index.tsx'), 'utf8');
const components = fs.readFileSync(path.join(here, 'components.tsx'), 'utf8');
const gateway = fs.readFileSync(path.join(here, '../../services/gateway/index.ts'), 'utf8');

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
