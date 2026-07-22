import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const tabBar = readFileSync(new URL('./TabBar.tsx', import.meta.url), 'utf8');
const appLayout = readFileSync(new URL('./AppLayout.tsx', import.meta.url), 'utf8');
const topBar = readFileSync(new URL('./TopBar.tsx', import.meta.url), 'utf8');

test('Tools opens its catalog before the dedicated terminal route', () => {
  assert.match(tabBar, /id: 'tools'.*path: '\/tools'/);
});

test('terminal keeps JunQi terminal chrome and its real sidebar controls', () => {
  assert.match(appLayout, /usesGlobalSidebar = !isWorkspacePage && !isTerminalPage && !isAgentWorkspacePage/);
  assert.match(appLayout, /terminal-kooky-app/);
  assert.match(appLayout, /sidebarTarget=\{isTerminalPage \? 'terminal' : isAgentWorkspacePage \? 'agent-workspace' : 'app'\}/);
  assert.match(topBar, /requestTerminalSidebarToggle/);
  assert.match(topBar, /requestAgentWorkspaceSidebarToggle/);
});

test('terminal, settings, and AI workspace expose a safe JunQi route-level back action', () => {
  assert.match(appLayout, /showBack=\{showRouteBack\}/);
  assert.match(appLayout, /showRouteBack = isTerminalPage \|\| isAgentWorkspacePage \|\| isSettingsPage/);
  assert.match(appLayout, /routeBackFallback = isTerminalPage \|\| isAgentWorkspacePage \? '\/tools' : '\/'/);
  assert.match(appLayout, /!isWorkspacePage && !isTerminalPage && <TabBar \/>/);
  assert.match(topBar, /window\.history\.state/);
  assert.match(topBar, /navigate\(-1\)/);
  assert.match(topBar, /navigate\(backFallback\)/);
});
