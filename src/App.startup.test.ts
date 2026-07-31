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
  assert.match(appSource, /const gatewayBootstrapDataReady = useGatewayDataStore/);
  assert.match(appSource, /state\.lastFetch\.sessions > 0 \|\| state\.errors\.sessions !== null/);
  assert.match(appSource, /state\.lastFetch\.agents > 0 \|\| state\.errors\.agents !== null/);
  assert.match(appSource, /void loadSessions\(\{ reconcileChatRuns: true \}\)\.then/);
  assert.match(appSource, /boot\.markStageCompleted\('config', 'Sessions ready'\);\s+initialSessionSnapshotSettledRef\.current = true/);
  assert.match(appSource, /if \(!workspaceDataReady && !gatewayOptionalRoute\)/);
});

test('workspace loading has a localized shared fallback and cannot wait forever after a session error', () => {
  assert.match(appSource, /boot\.markStageError\('config', 'Session load failed'\);\s+markInitialWorkspaceDataReady\(true\)/);
  assert.match(fallbackSource, /t\('app\.loadingWorkspace'\)/);
});
