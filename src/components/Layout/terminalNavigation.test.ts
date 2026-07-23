import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const tabBar = readFileSync(new URL('./TabBar.tsx', import.meta.url), 'utf8');
const appLayout = readFileSync(new URL('./AppLayout.tsx', import.meta.url), 'utf8');
const topBar = readFileSync(new URL('./TopBar.tsx', import.meta.url), 'utf8');

test('Tools opens its catalog before the dedicated terminal route', () => {
  assert.match(tabBar, /id: 'tools'.*path: '\/tools'/);
});

test('terminal keeps JunQi navigation and its real workspace sidebar controls', () => {
  assert.match(appLayout, /usesGlobalSidebar = !isWorkspacePage && !isAgentWorkspacePage/);
  assert.match(appLayout, /terminal-kooky-app/);
  assert.match(appLayout, /<NavSidebar presentation=\{isTerminalPage \? 'terminal-rail' : 'default'\} \/>/);
  assert.match(appLayout, /sidebarTarget=\{isTerminalPage \? 'terminal' : isAgentWorkspacePage \? 'agent-workspace' : 'app'\}/);
  assert.match(topBar, /requestTerminalSidebarToggle/);
  assert.match(topBar, /requestAgentWorkspaceSidebarToggle/);
});

test('only the drill-in AI workspace exposes a route-level back action', () => {
  assert.match(appLayout, /showBack=\{showRouteBack\}/);
  assert.match(appLayout, /showRouteBack = isAgentWorkspacePage/);
  assert.match(appLayout, /routeBackFallback = '\/tools'/);
  assert.doesNotMatch(appLayout, /isSettingsPage/);
  assert.match(appLayout, /!isWorkspacePage && !isTerminalPage && <TabBar \/>/);
  assert.match(topBar, /window\.history\.state/);
  assert.match(topBar, /navigate\(-1\)/);
  assert.match(topBar, /navigate\(backFallback\)/);
});
