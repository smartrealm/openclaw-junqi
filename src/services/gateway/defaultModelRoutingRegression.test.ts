import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

function source(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

test('BUG-DM-01 and BUG-DM-02 config and catalog refresh never pin a session', () => {
  const app = source('src/App.tsx');
  const tabs = source('src/components/Chat/ChatTabs.tsx');
  const loadModels = app.slice(
    app.indexOf('const loadAvailableModels'),
    app.indexOf('// ── Request notification permission'),
  );
  const configSaved = app.slice(
    app.indexOf('const handleConfigSaved'),
    app.indexOf("window.addEventListener('aegis:config-saved'"),
  );

  assert.doesNotMatch(loadModels, /setSessionModel|models\[0\]/);
  assert.doesNotMatch(configSaved, /setSessionModel|ensureRunning|primaryModel|providerChanged/);
  assert.match(configSaved, /loadAvailableModels/);
  assert.doesNotMatch(tabs, /inherit desktop session model|setSessionModel\(inheritedModel/);
});

test('BUG-DM-03 session settings expose the installed null reset contract', () => {
  const client = source('src/services/gateway/SessionSettingsClient.ts');
  const hook = source('src/components/Chat/session-runtime/useSessionRuntimeSettings.ts');
  const control = source('src/components/Chat/session-runtime/SessionRuntimeControl.tsx');

  assert.match(client, /setModel\(sessionKey: string, model: string \| null\)/);
  assert.match(hook, /gateway\.setSessionModel\(null, sessionKey\)/);
  assert.match(control, /restoreDefaultModel/);
  assert.match(control, /disabled=\{saving\}/);
  assert.doesNotMatch(control, /defaultModelId/);
});

test('BUG-DM-06 model patches rely on the Gateway sessions.changed invalidation only', () => {
  const hook = source('src/components/Chat/session-runtime/useSessionRuntimeSettings.ts');
  const app = source('src/App.tsx');

  assert.doesNotMatch(hook, /aegis:model-changed/);
  assert.doesNotMatch(app, /aegis:model-changed/);
  assert.match(app, /aegis:sessions-changed/);
});

test('BUG-DM-04 and BUG-DM-05 rendering and local storage do not choose model routing', () => {
  const providers = source('src/pages/ConfigManager/ProvidersTab.tsx');
  const configManager = source('src/pages/ConfigManager/index.tsx');
  const app = source('src/App.tsx');
  const sessionDelete = source('src/utils/sessionDelete.ts');

  assert.doesNotMatch(providers, /const desiredPrimary[\s\S]*modelIds\[0\]/);
  assert.doesNotMatch(configManager, /setAvailableModels\(\[\]\)/);
  assert.doesNotMatch(app, /sessionModelPrefs|SessionModelPref/);
  assert.doesNotMatch(sessionDelete, /sessionModelPrefs|SessionModelPref/);
});
