import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

test('the session action menu requests an official transcript fork', () => {
  const menu = source('src/components/Chat/session-actions/SessionActionsMenu.tsx');
  assert.match(menu, /parentSessionKey: session\.key,\s*fork: true,/);
});

test('the new-session picker keeps loading ownership and only closes after confirmed creation', () => {
  const tabs = source('src/components/Chat/ChatTabs.tsx');
  assert.match(tabs, /disabled=\{creatingSession\}/);
  assert.match(tabs, /onCreateNativeSession\(selectedAgentId, effectivePersona\)\.then\(\(created\) => \{\s*if \(created\) onClose\(\)/);
  assert.match(tabs, /if \(!result\.ok\) \{[\s\S]*?return false;/);
  assert.match(tabs, /if \(persona\?\.prompt\) applyPersonaToSessionDraft\(result\.session\.key, persona\)/);
});

test('route creation exposes an accessible explicit retry surface', () => {
  const page = source('src/pages/ChatPage.tsx');
  const hook = source('src/hooks/useAgentScopedSession.ts');
  assert.match(page, /role="alert"/);
  assert.match(page, /onClick=\{scopedSession\.retry\}/);
  assert.match(page, /disabled=\{scopedSession\.retrying\}/);
  assert.match(hook, /operation !== operationRef\.current/);
  assert.match(hook, /setParams\(nextParams, \{ replace: true \}\)/);
});
