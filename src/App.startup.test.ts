import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const fallbackSource = readFileSync(
  new URL('./components/shared/AppLoadingFallback.tsx', import.meta.url),
  'utf8',
);

test('the first workspace render waits for the authoritative session snapshot', () => {
  assert.match(appSource, /const \[workspaceDataReady, setWorkspaceDataReady\] = useState\(false\)/);
  assert.match(appSource, /useGatewayDataStore\(hasCurrentWorkspaceBootstrapData\)/);
  assert.match(appSource, /void loadSessions\(\{ reconcileChatRuns: true \}\)\.then/);
  assert.match(appSource, /type SessionLoadResult = 'loaded' \| 'failed' \| 'superseded'/);
  assert.match(appSource, /if \(sessionLoadResult === 'superseded'\) return/);
  assert.match(appSource, /boot\.markStageCompleted\('config', 'Sessions ready'\);\s+initialSessionSnapshotSettledRef\.current = true/);
  assert.match(appSource, /if \(!workspaceDataReady && !gatewayOptionalRoute\)/);
});

test('workspace startup failure remains gated and offers a localized retry', () => {
  assert.match(appSource, /const \[workspaceStartupFailed, setWorkspaceStartupFailed\] = useState\(false\)/);
  assert.match(appSource, /useGatewayDataStore\(hasCurrentWorkspaceBootstrapFailure\)/);
  assert.match(appSource, /boot\.markStageError\('config', 'Session load failed'\);\s+setWorkspaceStartupFailed\(true\)/);
  assert.doesNotMatch(appSource, /markInitialWorkspaceDataReady\(true\)/);
  assert.match(appSource, /onRetry=\{workspaceStartupFailed \? retryWorkspaceStartup : undefined\}/);
  assert.match(fallbackSource, /t\('app\.loadingWorkspace'\)/);
  assert.match(fallbackSource, /role="alert"/);
});
