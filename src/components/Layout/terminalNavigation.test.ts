import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const tabBar = readFileSync(new URL('./TabBar.tsx', import.meta.url), 'utf8');
const appLayout = readFileSync(new URL('./AppLayout.tsx', import.meta.url), 'utf8');
const topBar = readFileSync(new URL('./TopBar.tsx', import.meta.url), 'utf8');

test('Tools opens its catalog before the dedicated terminal route', () => {
  assert.match(tabBar, /id: 'tools'.*path: '\/tools'/);
});

test('terminal and AI workspaces own their left rail and top-bar toggle channels', () => {
  assert.match(appLayout, /usesGlobalSidebar = !isWorkspacePage && !isTerminalPage && !isAgentWorkspacePage/);
  assert.match(appLayout, /isAgentWorkspacePage \? 'agent-workspace' : 'app'/);
  assert.match(topBar, /requestTerminalSidebarToggle/);
  assert.match(topBar, /requestAgentWorkspaceSidebarToggle/);
});

test('settings and terminal expose a safe route-level back action without hijacking AI workspace navigation', () => {
  assert.match(appLayout, /showBack=\{showRouteBack\}/);
  assert.match(appLayout, /showRouteBack = isTerminalPage \|\| isSettingsPage/);
  assert.match(appLayout, /routeBackFallback = isTerminalPage \? '\/tools' : '\/'/);
  assert.doesNotMatch(appLayout, /showRouteBack = .*isAgentWorkspacePage/);
  assert.match(topBar, /window\.history\.state/);
  assert.match(topBar, /navigate\(-1\)/);
  assert.match(topBar, /navigate\(backFallback\)/);
});
